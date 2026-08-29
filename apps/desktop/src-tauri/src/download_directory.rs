use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

const SETTINGS_VERSION: u8 = 1;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct DownloadSettings {
    version: u8,
    default_download_directory: String,
}

#[derive(Debug)]
struct DirectorySelection {
    path: PathBuf,
    is_custom: bool,
}

pub struct DownloadDirectory {
    selection: Mutex<DirectorySelection>,
    settings_path: PathBuf,
}

impl DownloadDirectory {
    pub fn load(default_path: PathBuf, settings_path: PathBuf) -> Self {
        let saved_path = load_saved_path(&settings_path);
        let selection = match saved_path {
            Some(path) => DirectorySelection {
                path,
                is_custom: true,
            },
            None => DirectorySelection {
                path: default_path,
                is_custom: false,
            },
        };
        Self {
            selection: Mutex::new(selection),
            settings_path,
        }
    }

    pub fn current(&self) -> Result<PathBuf, String> {
        self.selection
            .lock()
            .map(|selection| selection.path.clone())
            .map_err(|_| "download directory settings are unavailable".to_owned())
    }

    pub fn set(&self, path: PathBuf) -> Result<PathBuf, String> {
        if !path.is_absolute() {
            return Err("the selected download directory must be absolute".to_owned());
        }
        validate_directory(&path)?;
        persist_path(&self.settings_path, &path)?;
        let mut selection = self
            .selection
            .lock()
            .map_err(|_| "download directory settings are unavailable".to_owned())?;
        selection.path = path.clone();
        selection.is_custom = true;
        Ok(path)
    }

    pub fn path_for_new_download(&self) -> Result<PathBuf, String> {
        let (path, is_custom) = self
            .selection
            .lock()
            .map(|selection| (selection.path.clone(), selection.is_custom))
            .map_err(|_| "download directory settings are unavailable".to_owned())?;
        if is_custom {
            validate_directory(&path)?;
        } else {
            fs::create_dir_all(&path)
                .map_err(|_| "the default download directory could not be created".to_owned())?;
            validate_directory(&path)?;
        }
        Ok(path)
    }
}

fn load_saved_path(settings_path: &Path) -> Option<PathBuf> {
    let contents = fs::read_to_string(settings_path).ok()?;
    let settings: DownloadSettings = serde_json::from_str(&contents).ok()?;
    if settings.version != SETTINGS_VERSION || settings.default_download_directory.trim().is_empty()
    {
        return None;
    }
    let path = PathBuf::from(settings.default_download_directory);
    path.is_absolute().then_some(path)
}

fn validate_directory(path: &Path) -> Result<(), String> {
    let metadata = fs::metadata(path)
        .map_err(|_| "the selected download directory is unavailable".to_owned())?;
    if !metadata.is_dir() {
        return Err("the selected download path is not a directory".to_owned());
    }
    Ok(())
}

fn persist_path(settings_path: &Path, path: &Path) -> Result<(), String> {
    let parent = settings_path
        .parent()
        .ok_or_else(|| "the settings directory is unavailable".to_owned())?;
    fs::create_dir_all(parent)
        .map_err(|_| "the settings directory could not be created".to_owned())?;
    let contents = serde_json::to_vec_pretty(&DownloadSettings {
        version: SETTINGS_VERSION,
        default_download_directory: path.to_string_lossy().into_owned(),
    })
    .map_err(|_| "download directory settings could not be serialized".to_owned())?;
    fs::write(settings_path, contents)
        .map_err(|_| "download directory settings could not be saved".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_root(label: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "torrent404-download-directory-{label}-{}-{suffix}",
            std::process::id()
        ))
    }

    #[test]
    fn missing_or_corrupt_settings_fall_back_to_the_default() {
        let root = temp_root("fallback");
        fs::create_dir_all(&root).expect("temporary root should be created");
        let settings_path = root.join("settings.v1.json");
        fs::write(&settings_path, b"not-json").expect("corrupt fixture should be written");
        let default_path = root.join("Downloads").join("Torrent404");

        let directory = DownloadDirectory::load(default_path.clone(), settings_path.clone());

        assert_eq!(directory.current().expect("current path"), default_path);
        assert_eq!(
            directory.path_for_new_download().expect("default path"),
            default_path
        );
        fs::write(
            &settings_path,
            br#"{"version":1,"defaultDownloadDirectory":"relative/path"}"#,
        )
        .expect("relative fixture should be written");
        let relative = DownloadDirectory::load(default_path.clone(), settings_path);
        assert_eq!(relative.current().expect("safe fallback"), default_path);
        assert!(default_path.is_dir());
        fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn custom_selection_is_persisted_and_reloaded() {
        let root = temp_root("persist");
        let custom_path = root.join("chosen");
        fs::create_dir_all(&custom_path).expect("custom directory should be created");
        let settings_path = root.join("app-data").join("settings.v1.json");
        let default_path = root.join("Downloads").join("Torrent404");
        let directory = DownloadDirectory::load(default_path.clone(), settings_path.clone());

        assert_eq!(
            directory.set(custom_path.clone()).expect("selection"),
            custom_path
        );
        let reloaded = DownloadDirectory::load(default_path, settings_path);

        assert_eq!(reloaded.current().expect("reloaded path"), custom_path);
        assert_eq!(
            reloaded.path_for_new_download().expect("download path"),
            custom_path
        );
        fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn unavailable_saved_directory_is_not_silently_replaced() {
        let root = temp_root("missing-custom");
        let custom_path = root.join("chosen");
        fs::create_dir_all(&custom_path).expect("custom directory should be created");
        let settings_path = root.join("app-data").join("settings.v1.json");
        let default_path = root.join("Downloads").join("Torrent404");
        let directory = DownloadDirectory::load(default_path.clone(), settings_path.clone());
        directory.set(custom_path.clone()).expect("selection");
        fs::remove_dir_all(&custom_path).expect("custom directory should be removed");

        let reloaded = DownloadDirectory::load(default_path, settings_path);

        assert_eq!(reloaded.current().expect("saved path"), custom_path);
        assert!(reloaded.path_for_new_download().is_err());
        fs::remove_dir_all(root).expect("temporary root should be removed");
    }

    #[test]
    fn changing_the_default_only_affects_new_download_paths() {
        let root = temp_root("new-downloads-only");
        let old_path = root.join("old");
        let new_path = root.join("new");
        fs::create_dir_all(&old_path).expect("old directory should be created");
        fs::create_dir_all(&new_path).expect("new directory should be created");
        let directory = DownloadDirectory::load(
            old_path.clone(),
            root.join("app-data").join("settings.v1.json"),
        );
        let existing_task_save_path = directory
            .path_for_new_download()
            .expect("existing task path");

        directory.set(new_path.clone()).expect("new selection");

        assert_eq!(
            directory.path_for_new_download().expect("new task path"),
            new_path
        );
        assert_eq!(existing_task_save_path, old_path);
        fs::remove_dir_all(root).expect("temporary root should be removed");
    }
}
