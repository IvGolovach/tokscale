use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use tokscale_core::ClientId;

const FRONTEND_REGISTRY_PATH: &str = "packages/frontend/src/lib/clientRegistry.json";
const FRONTEND_PUBLIC_PATH: &str = "packages/frontend/public";
const FRONTEND_ONLY_CLIENT_IDS: &[&str] = &["synthetic"];
const LEGACY_CLIENT_ALIASES: &[(&str, &str)] = &[("kilocode", "kilo")];

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrontendClientRegistry {
    client_ids: Vec<String>,
    legacy_client_aliases: BTreeMap<String, String>,
    source_display_names: BTreeMap<String, String>,
    source_logos: BTreeMap<String, String>,
    local_source_logos: BTreeMap<String, String>,
    source_colors: BTreeMap<String, String>,
    source_text_colors: BTreeMap<String, String>,
}

#[test]
fn frontend_client_registry_matches_rust_client_ids() {
    let repo_root = repo_root();
    let registry_path = repo_root.join(FRONTEND_REGISTRY_PATH);
    let registry: FrontendClientRegistry = serde_json::from_str(
        &fs::read_to_string(&registry_path).expect("failed to read frontend client registry"),
    )
    .expect("failed to parse frontend client registry JSON");

    let expected_aliases = LEGACY_CLIENT_ALIASES
        .iter()
        .map(|(legacy, canonical)| ((*legacy).to_string(), (*canonical).to_string()))
        .collect::<BTreeMap<_, _>>();
    assert_eq!(
        registry.legacy_client_aliases, expected_aliases,
        "frontend legacy client aliases drifted from the Rust-backed compatibility map"
    );

    let frontend_client_ids = registry.client_ids.into_iter().collect::<BTreeSet<_>>();
    let expected_client_ids = expected_frontend_client_ids();
    assert_eq!(
        frontend_client_ids, expected_client_ids,
        "frontend canonical client IDs drifted from Rust ClientId plus explicit frontend-only clients"
    );

    let expected_display_ids = expected_display_ids(&expected_client_ids);
    for (name, actual) in [
        ("source_display_names", registry.source_display_names),
        ("source_logos", registry.source_logos),
        ("source_colors", registry.source_colors),
    ] {
        let actual_keys = actual.into_keys().collect::<BTreeSet<_>>();
        assert_eq!(
            actual_keys, expected_display_ids,
            "{name} keys drifted from the expected canonical plus legacy client IDs"
        );
    }

    let local_logo_keys = registry
        .local_source_logos
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    assert!(
        local_logo_keys.is_subset(&expected_display_ids),
        "local_source_logos must only define overrides for known client IDs"
    );

    let text_color_keys = registry
        .source_text_colors
        .into_keys()
        .collect::<BTreeSet<_>>();
    assert!(
        text_color_keys.is_subset(&expected_display_ids),
        "source_text_colors must only define overrides for known client IDs"
    );

    for (client_id, asset_path) in &registry.local_source_logos {
        let asset_path = asset_path.trim_start_matches('/');
        let absolute_path = repo_root.join(FRONTEND_PUBLIC_PATH).join(asset_path);
        assert!(
            absolute_path.is_file(),
            "missing local logo asset for client `{client_id}` at {}",
            absolute_path.display()
        );
    }
}

fn repo_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .expect("failed to resolve repo root")
}

fn expected_frontend_client_ids() -> BTreeSet<String> {
    let aliases = LEGACY_CLIENT_ALIASES
        .iter()
        .copied()
        .collect::<BTreeMap<_, _>>();
    let mut client_ids = ClientId::iter()
        .map(|client| normalize_client_id(client.as_str(), &aliases).to_string())
        .collect::<BTreeSet<_>>();
    client_ids.extend(FRONTEND_ONLY_CLIENT_IDS.iter().map(|id| (*id).to_string()));
    client_ids
}

fn expected_display_ids(frontend_client_ids: &BTreeSet<String>) -> BTreeSet<String> {
    let mut display_ids = frontend_client_ids.clone();
    display_ids.extend(
        LEGACY_CLIENT_ALIASES
            .iter()
            .map(|(legacy, _)| (*legacy).to_string()),
    );
    display_ids
}

fn normalize_client_id<'a>(client_id: &'a str, aliases: &'a BTreeMap<&str, &str>) -> &'a str {
    aliases.get(client_id).copied().unwrap_or(client_id)
}
