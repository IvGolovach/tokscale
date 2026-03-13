use crate::sessions::codex::CodexParseState;
use crate::UnifiedMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const CACHE_SCHEMA_VERSION: u32 = 2;
const CACHE_FILENAME: &str = "source-message-cache.bin";
const CODEX_TAIL_SAMPLE_BYTES: usize = 8192;

fn cache_dir() -> PathBuf {
    dirs::cache_dir()
        .unwrap_or_else(|| PathBuf::from("/tmp"))
        .join("tokscale")
}

fn cache_path() -> PathBuf {
    cache_dir().join(CACHE_FILENAME)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SourceFingerprint {
    pub size: u64,
    pub modified_ms: u64,
}

impl SourceFingerprint {
    pub(crate) fn from_path(path: &Path) -> Option<Self> {
        let metadata = path.metadata().ok()?;
        let modified_ms = metadata
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_millis() as u64;

        Some(Self {
            size: metadata.len(),
            modified_ms,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CodexIncrementalCache {
    pub state: CodexParseState,
    pub tail_sample: Vec<u8>,
    pub ends_with_newline: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CachedSourceEntry {
    pub path: String,
    pub fingerprint: SourceFingerprint,
    pub messages: Vec<UnifiedMessage>,
    pub codex_incremental: Option<CodexIncrementalCache>,
}

impl CachedSourceEntry {
    pub(crate) fn new(
        path: &Path,
        fingerprint: SourceFingerprint,
        messages: Vec<UnifiedMessage>,
        codex_incremental: Option<CodexIncrementalCache>,
    ) -> Self {
        Self {
            path: path.to_string_lossy().to_string(),
            fingerprint,
            messages,
            codex_incremental,
        }
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct CachedSourceStore {
    schema_version: u32,
    entries: Vec<CachedSourceEntry>,
}

#[derive(Default)]
pub(crate) struct SourceMessageCache {
    pub entries: HashMap<String, CachedSourceEntry>,
    dirty: bool,
}

impl SourceMessageCache {
    pub(crate) fn load() -> Self {
        let path = cache_path();
        let file = match File::open(path) {
            Ok(file) => file,
            Err(_) => return Self::default(),
        };

        let reader = BufReader::new(file);
        let store: CachedSourceStore = match bincode::deserialize_from(reader) {
            Ok(store) => store,
            Err(_) => return Self::default(),
        };

        if store.schema_version != CACHE_SCHEMA_VERSION {
            return Self::default();
        }

        let entries = store
            .entries
            .into_iter()
            .map(|entry| (entry.path.clone(), entry))
            .collect();

        Self {
            entries,
            dirty: false,
        }
    }

    pub(crate) fn insert(&mut self, entry: CachedSourceEntry) {
        self.entries.insert(entry.path.clone(), entry);
        self.dirty = true;
    }

    pub(crate) fn save_if_dirty(&self) {
        if !self.dirty {
            return;
        }

        let dir = cache_dir();
        if fs::create_dir_all(&dir).is_err() {
            return;
        }

        let store = CachedSourceStore {
            schema_version: CACHE_SCHEMA_VERSION,
            entries: self.entries.values().cloned().collect(),
        };

        let final_path = cache_path();
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0);
        let tmp_path = dir.join(format!(
            ".{}.{}.{:x}.tmp",
            CACHE_FILENAME,
            std::process::id(),
            nanos
        ));

        let write_result = (|| -> std::io::Result<()> {
            let file = File::create(&tmp_path)?;
            let mut writer = BufWriter::new(file);
            bincode::serialize_into(&mut writer, &store).map_err(std::io::Error::other)?;
            writer.flush()?;
            writer.get_ref().sync_all()?;
            if fs::rename(&tmp_path, &final_path).is_err() {
                fs::copy(&tmp_path, &final_path)?;
                let _ = fs::remove_file(&tmp_path);
            }
            Ok(())
        })();

        if write_result.is_err() {
            let _ = fs::remove_file(&tmp_path);
        }
    }
}

fn read_tail_sample(path: &Path, end_offset: u64) -> Option<Vec<u8>> {
    if end_offset == 0 {
        return Some(Vec::new());
    }

    let bytes_to_read = end_offset.min(CODEX_TAIL_SAMPLE_BYTES as u64) as usize;
    let start_offset = end_offset.saturating_sub(bytes_to_read as u64);

    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(start_offset)).ok()?;

    let mut buffer = vec![0_u8; bytes_to_read];
    file.read_exact(&mut buffer).ok()?;
    Some(buffer)
}

pub(crate) fn build_codex_incremental_cache(
    path: &Path,
    fingerprint: &SourceFingerprint,
    state: CodexParseState,
) -> Option<CodexIncrementalCache> {
    let tail_sample = read_tail_sample(path, fingerprint.size)?;
    Some(CodexIncrementalCache {
        state,
        ends_with_newline: fingerprint.size == 0 || tail_sample.last().copied() == Some(b'\n'),
        tail_sample,
    })
}

pub(crate) fn codex_tail_matches(
    path: &Path,
    previous_size: u64,
    ends_with_newline: bool,
    expected_tail_sample: &[u8],
) -> bool {
    if previous_size > 0 && !ends_with_newline {
        return false;
    }

    match read_tail_sample(path, previous_size) {
        Some(actual) => actual == expected_tail_sample,
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::TokenBreakdown;
    use std::io::Write;
    use tempfile::{NamedTempFile, TempDir};

    fn write_temp_file(content: &[u8]) -> NamedTempFile {
        let mut file = NamedTempFile::new().unwrap();
        file.write_all(content).unwrap();
        file.flush().unwrap();
        file
    }

    #[test]
    fn test_codex_tail_matches_appended_file() {
        let file = write_temp_file(b"line-1\nline-2\n");
        let fingerprint = SourceFingerprint::from_path(file.path()).unwrap();
        let incremental_cache =
            build_codex_incremental_cache(file.path(), &fingerprint, CodexParseState::default())
                .unwrap();

        let mut reopened = file.reopen().unwrap();
        reopened.seek(SeekFrom::End(0)).unwrap();
        reopened.write_all(b"line-3\n").unwrap();
        reopened.flush().unwrap();

        assert!(codex_tail_matches(
            file.path(),
            fingerprint.size,
            incremental_cache.ends_with_newline,
            &incremental_cache.tail_sample,
        ));
    }

    #[test]
    #[serial_test::serial]
    fn test_source_message_cache_round_trip() {
        let temp_home = TempDir::new().unwrap();
        let original_home = std::env::var("HOME").ok();
        std::env::set_var("HOME", temp_home.path());

        let file = write_temp_file(b"{}\n");
        let fingerprint = SourceFingerprint::from_path(file.path()).unwrap();
        let entry = CachedSourceEntry::new(
            file.path(),
            fingerprint,
            vec![UnifiedMessage::new(
                "client",
                "gpt-5",
                "provider",
                "session-1",
                1,
                TokenBreakdown {
                    input: 1,
                    output: 2,
                    cache_read: 3,
                    cache_write: 0,
                    reasoning: 0,
                },
                0.0,
            )],
            None,
        );

        let mut cache = SourceMessageCache::default();
        cache.insert(entry);
        cache.save_if_dirty();

        let loaded = SourceMessageCache::load();
        assert_eq!(loaded.entries.len(), 1);
        assert!(loaded
            .entries
            .contains_key(&file.path().to_string_lossy().to_string()));

        match original_home {
            Some(home) => std::env::set_var("HOME", home),
            None => std::env::remove_var("HOME"),
        }
    }
}
