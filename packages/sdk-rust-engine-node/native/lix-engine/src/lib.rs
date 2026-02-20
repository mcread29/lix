use serde::Serialize;
use sqlparser::ast::Statement;
use sqlparser::dialect::SQLiteDialect;
use sqlparser::parser::Parser;

pub const RUST_KIND_READ_REWRITE: &str = "read_rewrite";
pub const RUST_KIND_WRITE_REWRITE: &str = "write_rewrite";
pub const RUST_KIND_VALIDATION: &str = "validation";
pub const RUST_KIND_PASSTHROUGH: &str = "passthrough";

pub const RUST_ROWS_AFFECTED_ROWS_LENGTH: &str = "rows_length";
pub const RUST_ROWS_AFFECTED_SQLITE_CHANGES: &str = "sqlite_changes";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePlan {
    pub statement_kind: &'static str,
    pub preprocess_mode: &'static str,
    pub rows_affected_mode: &'static str,
}

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
            Statement::Insert(_) => {
                saw_write = true;
            }
            Statement::Update { .. } => {
                saw_write = true;
            }
            Statement::Delete(_) => {
                saw_write = true;
            }
            _ => {
                return RUST_KIND_PASSTHROUGH;
            }
        }
    }

    if saw_write {
        if is_validation_sql(sql) {
            return RUST_KIND_VALIDATION;
        }
        return RUST_KIND_WRITE_REWRITE;
    }

    if saw_read {
        return RUST_KIND_READ_REWRITE;
    }

    RUST_KIND_PASSTHROUGH
}

pub fn plan_execute(sql: &str) -> ExecutePlan {
    let statement_kind = route_statement_kind(sql);
    let preprocess_mode = if statement_kind == RUST_KIND_PASSTHROUGH {
        "none"
    } else {
        "full"
    };
    let rows_affected_mode =
        if statement_kind == RUST_KIND_READ_REWRITE || statement_kind == RUST_KIND_PASSTHROUGH {
            RUST_ROWS_AFFECTED_ROWS_LENGTH
        } else {
            RUST_ROWS_AFFECTED_SQLITE_CHANGES
        };
    ExecutePlan {
        statement_kind,
        preprocess_mode,
        rows_affected_mode,
    }
}

fn is_validation_sql(sql: &str) -> bool {
    let lowered = sql.to_lowercase();
    lowered.contains("insert into state")
        || lowered.contains("insert into state_all")
        || lowered.contains("update state")
        || lowered.contains("update state_all")
        || lowered.contains("delete from state")
        || lowered.contains("delete from state_all")
}

#[cfg(test)]
mod tests {
    use super::{
        plan_execute, route_statement_kind, RUST_KIND_PASSTHROUGH, RUST_KIND_READ_REWRITE,
        RUST_KIND_VALIDATION, RUST_KIND_WRITE_REWRITE, RUST_ROWS_AFFECTED_ROWS_LENGTH,
        RUST_ROWS_AFFECTED_SQLITE_CHANGES,
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

    #[test]
    fn routes_validation_for_state_table_writes() {
        assert_eq!(
            route_statement_kind("insert into state (entity_id) values ('e')"),
            RUST_KIND_VALIDATION
        );
        assert_eq!(
            route_statement_kind("update state set schema_key = 'x' where entity_id = 'e'"),
            RUST_KIND_VALIDATION
        );
    }

    #[test]
    fn plans_read_execution() {
        let plan = plan_execute("select 1");
        assert_eq!(plan.statement_kind, RUST_KIND_READ_REWRITE);
        assert_eq!(plan.preprocess_mode, "full");
        assert_eq!(plan.rows_affected_mode, RUST_ROWS_AFFECTED_ROWS_LENGTH);
    }

    #[test]
    fn plans_write_and_validation_execution() {
        let write_plan = plan_execute("insert into file (id) values ('x')");
        assert_eq!(write_plan.statement_kind, RUST_KIND_WRITE_REWRITE);
        assert_eq!(write_plan.preprocess_mode, "full");
        assert_eq!(
            write_plan.rows_affected_mode,
            RUST_ROWS_AFFECTED_SQLITE_CHANGES
        );

        let validation_plan = plan_execute("insert into state (entity_id) values ('x')");
        assert_eq!(validation_plan.statement_kind, RUST_KIND_VALIDATION);
        assert_eq!(validation_plan.preprocess_mode, "full");
        assert_eq!(
            validation_plan.rows_affected_mode,
            RUST_ROWS_AFFECTED_SQLITE_CHANGES
        );
    }
}
