use std::env;
use std::process;

use lix_engine::{plan_execute, route_statement_kind, RUST_KIND_PASSTHROUGH};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("expected command: route");
        process::exit(2);
    }

    match args[1].as_str() {
        "route" => {
            if args.len() < 3 {
                println!("{}", RUST_KIND_PASSTHROUGH);
                return;
            }

            let sql = args[2..].join(" ");
            let kind = route_statement_kind(&sql);
            println!("{}", kind);
        }
        "plan" => {
            if args.len() < 3 {
                eprintln!("expected SQL argument for plan command");
                process::exit(2);
            }
            let sql = args[2..].join(" ");
            let plan = plan_execute(&sql);
            match serde_json::to_string(&plan) {
                Ok(json) => println!("{}", json),
                Err(error) => {
                    eprintln!("failed to serialize execute plan: {}", error);
                    process::exit(1);
                }
            }
        }
        _ => {
            eprintln!("unsupported command: {}", args[1]);
            process::exit(2);
        }
    }
}
