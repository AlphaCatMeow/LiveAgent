fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR");
    let proto_dir = std::path::Path::new(&manifest_dir)
        .join("..")
        .join("..")
        .join("agent-gateway")
        .join("proto")
        .join("v1");
    let proto_file = proto_dir.join("gateway.proto");

    println!("cargo:rerun-if-changed={}", proto_file.display());

    tonic_build::configure()
        .build_server(false)
        .compile_protos(&[proto_file], &[proto_dir])
        .expect("compile gateway proto");

    tauri_build::build()
}
