use riverline_solver::{collect, run, RiverInput};
use std::{env, fs, process};
mod worker;

fn execute() -> Result<(), String> {
    let args: Vec<String> = env::args().collect();
    if args.len() == 3 && args[1] == "preflight-river" {
        let bytes = fs::read(&args[2]).map_err(|e| e.to_string())?;
        if bytes.len() > 1024 * 1024 {
            return Err("input >1MiB".into());
        }
        let input: RiverInput = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
        let game = riverline_solver::build(&input)?;
        let memory = game.memory_usage().0;
        if memory > input.limits.max_memory_bytes {
            return Err("budget-exceeded: memory".into());
        }
        println!("{{\"ok\":true,\"estimatedBytes\":{memory}}}");
        return Ok(());
    }
    if args.len() == 3 && args[1] == "worker" {
        return worker::serve(std::path::Path::new(&args[2]));
    }
    if args.len() != 4 || args[1] != "validate-river" {
        return Err("usage: riverline-solver validate-river INPUT.json OUTPUT.json".into());
    }
    let bytes = fs::read(&args[2]).map_err(|e| e.to_string())?;
    if bytes.len() > 1024 * 1024 {
        return Err("input >1MiB".into());
    }
    let input: RiverInput = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let (mut game, mut report) = run(input, || false, |_, _| {})?;
    report.nodes = collect(&mut game)?;
    // R1 verifies native serialization and readback without claiming resumable CFR state.
    let archive = format!("{}.native.bin", args[3]);
    postflop_solver::save_data_to_file(&game, "riverline-r1", &archive, None)?;
    let (mut restored, _): (postflop_solver::PostFlopGame, String) =
        postflop_solver::load_data_from_file(&archive, Some(report.input.limits.max_memory_bytes))?;
    let restored_nodes = collect(&mut restored)?;
    if serde_json::to_value(&restored_nodes).map_err(|e| e.to_string())?
        != serde_json::to_value(&report.nodes).map_err(|e| e.to_string())?
    {
        return Err("native-readback-mismatch".into());
    }
    fs::write(
        &args[3],
        serde_json::to_vec_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    println!(
        "{{\"ok\":true,\"iterations\":{},\"exploitability\":{}}}",
        report.iterations, report.exploitability
    );
    Ok(())
}

fn main() {
    if let Err(error) = execute() {
        eprintln!("{error}");
        process::exit(1);
    }
}
