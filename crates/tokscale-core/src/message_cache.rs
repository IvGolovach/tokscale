use crate::sessions::codex::CodexParseState;
use crate::UnifiedMessage;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

const CACHE_SCHEMA_VERSION: u32 = 3;
const CACHE_FILENAME: &str = "source-message-cache.bin";
const FINGERPRINT_SAMPLE_BYTES: usize = 4096;
const FINGERPRINT_SAMPLE_POINTS: usize = 5;

fn cache_dir() -> Option<PathBuf> {
    dirs::cache_dir().map(|path| path.join("tokscale"))
}

fn cache_path() -> Option<PathBuf> {
    Some(cache_dir()?.join(CACHE_FILENAME))
}

fn ensure_cache_dir(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;

        fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FileSampleHash {
    pub offset: u64,
    pub len: u64,
    pub hash: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct SourceFingerprint {
    pub size: u64,
    pub modified_ns: u64,
    pub sample_hashes: Vec<FileSampleHash>,
}

impl SourceFingerprint {
    pub(crate) fn from_path(path: &Path) -> Option<Self> {
        let metadata = path.metadata().ok()?;
        let size = metadata.len();
        let modified_ns = metadata
            .modified()
            .ok()?
            .duration_since(UNIX_EPOCH)
            .ok()?
            .as_nanos() as u64;
        let sample_hashes = compute_sample_hashes(path, size)?;

        Some(Self {
            size,
            modified_ns,
            sample_hashes,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct CodexIncrementalCache {
    pub state: CodexParseState,
    pub ends_with_newline: bool,
    pub fallback_timestamp_indices: Vec<usize>,
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
        let Some(path) = cache_path() else {
            return Self::default();
        };
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

    pub(crate) fn prune_missing_files(&mut self) {
        let original_len = self.entries.len();
        self.entries.retain(|path, _| Path::new(path).exists());
        if self.entries.len() != original_len {
            self.dirty = true;
        }
    }

    pub(crate) fn save_if_dirty(&self) {
        if !self.dirty {
            return;
        }

        let Some(dir) = cache_dir() else {
            return;
        };
        if ensure_cache_dir(&dir).is_err() {
            return;
        }

        let store = CachedSourceStore {
            schema_version: CACHE_SCHEMA_VERSION,
            entries: self.entries.values().cloned().collect(),
        };

        let Some(final_path) = cache_path() else {
            return;
        };
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

fn read_sample_hash(file: &mut File, offset: u64, len: usize) -> Option<FileSampleHash> {
    if len == 0 {
        return Some(FileSampleHash {
            offset,
            len: 0,
            hash: 0,
        });
    }

    file.seek(SeekFrom::Start(offset)).ok()?;
    let mut buffer = vec![0_u8; len];
    file.read_exact(&mut buffer).ok()?;

    Some(FileSampleHash {
        offset,
        len: len as u64,
        hash: hash_bytes(&buffer),
    })
}

fn compute_sample_hashes(path: &Path, size: u64) -> Option<Vec<FileSampleHash>> {
    if size == 0 {
        return Some(Vec::new());
    }

    let mut file = File::open(path).ok()?;
    let offsets = sample_offsets(size);
    offsets
        .into_iter()
        .map(|(offset, len)| read_sample_hash(&mut file, offset, len))
        .collect()
}

fn sample_offsets(size: u64) -> Vec<(u64, usize)> {
    let sample_len = size.min(FINGERPRINT_SAMPLE_BYTES as u64) as usize;
    if sample_len == 0 {
        return Vec::new();
    }

    let max_offset = size.saturating_sub(sample_len as u64);
    let mut offsets = if max_offset == 0 {
        vec![0]
    } else {
        vec![
            0,
            max_offset / 4,
            max_offset / 2,
            max_offset.saturating_mul(3) / 4,
            max_offset,
        ]
    };
    offsets.sort_unstable();
    offsets.dedup();
    offsets.truncate(FINGERPRINT_SAMPLE_POINTS);
    offsets
        .into_iter()
        .map(|offset| (offset, sample_len))
        .collect()
}

fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

pub(crate) fn sample_hashes_match(path: &Path, expected: &[FileSampleHash]) -> bool {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    expected.iter().all(|sample| {
        let Some(actual) = read_sample_hash(&mut file, sample.offset, sample.len as usize) else {
            return false;
        };
        actual == *sample
    })
}

pub(crate) fn build_codex_incremental_cache(
    path: &Path,
    fingerprint: &SourceFingerprint,
    state: CodexParseState,
    fallback_timestamp_indices: Vec<usize>,
) -> Option<CodexIncrementalCache> {
    Some(CodexIncrementalCache {
        state,
        ends_with_newline: fingerprint.size == 0 || file_ends_with_newline(path, fingerprint.size),
        fallback_timestamp_indices,
    })
}

fn file_ends_with_newline(path: &Path, size: u64) -> bool {
    if size == 0 {
        return true;
    }

    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(_) => return false,
    };
    if file.seek(SeekFrom::Start(size.saturating_sub(1))).is_err() {
        return false;
    }

    let mut byte = [0_u8; 1];
    file.read_exact(&mut byte).is_ok() && byte[0] == b'\n'
}

pub(crate) fn codex_prefix_matches(
    path: &Path,
    previous_fingerprint: &SourceFingerprint,
    ends_with_newline: bool,
) -> bool {
    if previous_fingerprint.size > 0 && !ends_with_newline {
        return false;
    }

    sample_hashes_match(path, &previous_fingerprint.sample_hashes)
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
    fn test_codex_prefix_matches_appended_file() {
        let file = write_temp_file(b"line-1\nline-2\n");
        let fingerprint = SourceFingerprint::from_path(file.path()).unwrap();
        let incremental_cache = build_codex_incremental_cache(
            file.path(),
            &fingerprint,
            CodexParseState::default(),
            Vec::new(),
        )
        .unwrap();

        let mut reopened = file.reopen().unwrap();
        reopened.seek(SeekFrom::End(0)).unwrap();
        reopened.write_all(b"line-3\n").unwrap();
        reopened.flush().unwrap();

        assert!(codex_prefix_matches(
            file.path(),
            &fingerprint,
            incremental_cache.ends_with_newline,
        ));
    }

    #[test]
    fn test_source_fingerprint_changes_for_same_size_rewrite() {
        let file = write_temp_file(b"aaaa\nbbbb\ncccc\n");
        let before = SourceFingerprint::from_path(file.path()).unwrap();

        std::fs::write(file.path(), b"aaaa\nzzzz\ncccc\n").unwrap();

        let after = SourceFingerprint::from_path(file.path()).unwrap();
        assert_ne!(before, after);
    }

    #[test]
    fn test_codex_prefix_matches_rejects_middle_rewrite_with_same_tail() {
        let file = write_temp_file(b"aaaa\nbbbb\ncccc\n");
        let fingerprint = SourceFingerprint::from_path(file.path()).unwrap();

        std::fs::write(file.path(), b"aaaa\nzzzz\ncccc\nmore\n").unwrap();

        assert!(!codex_prefix_matches(file.path(), &fingerprint, true));
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

    #[test]
    fn test_prune_missing_files_removes_deleted_entries() {
        let file = write_temp_file(b"{}\n");
        let fingerprint = SourceFingerprint::from_path(file.path()).unwrap();
        let path = file.path().to_path_buf();

        let mut cache = SourceMessageCache::default();
        cache.insert(CachedSourceEntry::new(&path, fingerprint, Vec::new(), None));

        std::fs::remove_file(&path).unwrap();
        cache.prune_missing_files();

        assert!(cache.entries.is_empty());
    }
}
