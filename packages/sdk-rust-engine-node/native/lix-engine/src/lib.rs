use sqlparser::ast::Statement;
use sqlparser::dialect::SQLiteDialect;
use sqlparser::parser::Parser;

pub const RUST_KIND_READ_REWRITE: &str = "read_rewrite";
pub const RUST_KIND_WRITE_REWRITE: &str = "write_rewrite";
pub const RUST_KIND_PASSTHROUGH: &str = "passthrough";

pub fn route_statement_kind(sql: &str) -> &'static str {
    let dialect = SQLiteDialect {};
    let parsed = Parser::parse_sql(&dialect, sql);

    let statements = match parsed {
        Ok(value) if !value.is_empty() => value,
        _ => return RUST_KIND_PASSTHROUGH,
    };

    let mut saw_read = false;
    let mut saw_write = false;

    for statement in statements {
        match statement {
            Statement::Query(_) => {
                saw_read = true;
            }
            Statement::Insert(_) | Statement::Update { .. } | Statement::Delete(_) => {
                saw_write = true;
            }
            _ => {
                return RUST_KIND_PASSTHROUGH;
            }
        }
    }

    if saw_write {
        return RUST_KIND_WRITE_REWRITE;
    }

    if saw_read {
        return RUST_KIND_READ_REWRITE;
    }

    RUST_KIND_PASSTHROUGH
}

#[cfg(test)]
mod tests {
    use super::{
        route_statement_kind, RUST_KIND_PASSTHROUGH, RUST_KIND_READ_REWRITE,
        RUST_KIND_WRITE_REWRITE,
    };

    #[test]
    fn routes_reads() {
        assert_eq!(route_statement_kind("select 1"), RUST_KIND_READ_REWRITE);
    }

    #[test]
    fn routes_writes() {
        assert_eq!(
            route_statement_kind("insert into file (id) values ('x')"),
            RUST_KIND_WRITE_REWRITE
        );
    }

    #[test]
    fn routes_passthrough() {
        assert_eq!(
            route_statement_kind("pragma user_version"),
            RUST_KIND_PASSTHROUGH
        );
    }
}
