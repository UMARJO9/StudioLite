fn main() {
    // The app icon is embedded at compile time; without this cargo does not notice
    // when only the icon files change and keeps the old one.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
