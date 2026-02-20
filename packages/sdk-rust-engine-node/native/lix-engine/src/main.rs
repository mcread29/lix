use std::env;
use std::process;

use lix_engine::{route_statement_kind, RUST_KIND_PASSTHROUGH};

fn main() {
    let args: Vec<String> = env::args().collect();

    if args.len() < 2 {
        eprintln!("expected command: route");
        process::exit(2);
    }

    if args[1] != "route" {
        eprintln!("unsupported command: {}", args[1]);
        process::exit(2);
    }

    if args.len() < 3 {
        println!("{}", RUST_KIND_PASSTHROUGH);
        return;
    }

    let sql = args[2..].join(" ");
    let kind = route_statement_kind(&sql);
    println!("{}", kind);
}
