use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlparser::ast::Statement;
use sqlparser::dialect::SQLiteDialect;
use sqlparser::parser::Parser;

pub const RUST_KIND_READ_REWRITE: &str = "read_rewrite";
pub const RUST_KIND_WRITE_REWRITE: &str = "write_rewrite";
pub const RUST_KIND_VALIDATION: &str = "validation";
pub const RUST_KIND_PASSTHROUGH: &str = "passthrough";

pub const RUST_ROWS_AFFECTED_ROWS_LENGTH: &str = "rows_length";
pub const RUST_ROWS_AFFECTED_SQLITE_CHANGES: &str = "sqlite_changes";

pub const LIX_RUST_SQLITE_EXECUTION: &str = "LIX_RUST_SQLITE_EXECUTION";
pub const LIX_RUST_DETECT_CHANGES: &str = "LIX_RUST_DETECT_CHANGES";
pub const LIX_RUST_REWRITE_VALIDATION: &str = "LIX_RUST_REWRITE_VALIDATION";
pub const LIX_RUST_UNSUPPORTED_SQLITE_FEATURE: &str = "LIX_RUST_UNSUPPORTED_SQLITE_FEATURE";
pub const LIX_RUST_PROTOCOL_MISMATCH: &str = "LIX_RUST_PROTOCOL_MISMATCH";
pub const LIX_RUST_TIMEOUT: &str = "LIX_RUST_TIMEOUT";
pub const LIX_RUST_UNKNOWN: &str = "LIX_RUST_UNKNOWN";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExecutePlan {
    pub statement_kind: &'static str,
    pub preprocess_mode: &'static str,
    pub rows_affected_mode: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteRequest {
    pub request_id: String,
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
    #[serde(default)]
    pub plugin_change_requests: Vec<PluginChangeRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PluginChangeRequest {
    pub plugin_key: String,
    #[serde(default)]
    pub before: Vec<u8>,
    #[serde(default)]
    pub after: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ExecuteResult {
    pub statement_kind: &'static str,
    pub rows: Vec<Value>,
    pub rows_affected: i64,
    pub last_insert_row_id: Option<i64>,
    pub plugin_changes: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostExecuteRequest {
    pub request_id: String,
    pub sql: String,
    #[serde(default)]
    pub params: Vec<Value>,
    pub statement_kind: &'static str,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostExecuteResponse {
    #[serde(default)]
    pub rows: Vec<Value>,
    pub rows_affected: i64,
    pub last_insert_row_id: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HostDetectChangesRequest {
    pub request_id: String,
    pub plugin_key: String,
    #[serde(default)]
    pub before: Vec<u8>,
    #[serde(default)]
    pub after: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HostDetectChangesResponse {
    #[serde(default)]
    pub changes: Vec<Value>,
}

pub trait HostCallbacks {
    fn execute(&self, request: HostExecuteRequest) -> Result<HostExecuteResponse, EngineError>;
    fn detect_changes(
        &self,
        request: HostDetectChangesRequest,
    ) -> Result<HostDetectChangesResponse, EngineError>;
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EngineError {
    pub code: &'static str,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn rewrite_validation(message: impl Into<String>) -> Self {
        Self::new(LIX_RUST_REWRITE_VALIDATION, message)
    }

    fn protocol_mismatch(message: impl Into<String>) -> Self {
        Self::new(LIX_RUST_PROTOCOL_MISMATCH, message)
    }
}

pub fn execute_with_host(
    host: &dyn HostCallbacks,
    request: ExecuteRequest,
) -> Result<ExecuteResult, EngineError> {
    let plan = plan_execute(&request.sql);
    let statement_kind = plan.statement_kind;
    let rewritten_sql = rewrite_sql_for_execution(&request.sql, statement_kind)?;

    if statement_kind == RUST_KIND_VALIDATION {
        validate_validation_mutations(&rewritten_sql)?;
    }

    let execute_response = host
        .execute(HostExecuteRequest {
            request_id: request.request_id.clone(),
            sql: rewritten_sql,
            params: request.params,
            statement_kind,
        })
        .map_err(|error| map_host_error(error, LIX_RUST_SQLITE_EXECUTION))?;

    let plugin_changes =
        if statement_kind == RUST_KIND_WRITE_REWRITE || statement_kind == RUST_KIND_VALIDATION {
            execute_plugin_change_detection(
                host,
                &request.request_id,
                request.plugin_change_requests.as_slice(),
            )?
        } else {
            Vec::new()
        };

    let rows_affected = if plan.rows_affected_mode == RUST_ROWS_AFFECTED_ROWS_LENGTH {
        execute_response.rows.len() as i64
    } else {
        execute_response.rows_affected
    };

    Ok(ExecuteResult {
        statement_kind,
        rows: execute_response.rows,
        rows_affected,
        last_insert_row_id: execute_response.last_insert_row_id,
        plugin_changes,
    })
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

fn rewrite_sql_for_execution(
    sql: &str,
    statement_kind: &'static str,
) -> Result<String, EngineError> {
    if statement_kind == RUST_KIND_PASSTHROUGH {
        return Ok(sql.to_owned());
    }

    let dialect = SQLiteDialect {};
    let parsed = Parser::parse_sql(&dialect, sql).map_err(|error| {
        EngineError::protocol_mismatch(format!("failed to parse SQL for rewrite: {error}"))
    })?;

    if parsed.is_empty() {
        return Err(EngineError::protocol_mismatch(
            "expected at least one statement for rewrite",
        ));
    }

    Ok(sql.to_owned())
}

fn validate_validation_mutations(sql: &str) -> Result<(), EngineError> {
    let dialect = SQLiteDialect {};
    let statements = Parser::parse_sql(&dialect, sql).map_err(|error| {
        EngineError::rewrite_validation(format!("failed to parse validation SQL: {error}"))
    })?;

    if statements.is_empty() {
        return Err(EngineError::rewrite_validation(
            "validation SQL must include at least one mutation statement",
        ));
    }

    for statement in statements {
        if !is_validation_mutation_statement(&statement) {
            return Err(EngineError::rewrite_validation(
                "validation statements may only mutate state or state_all",
            ));
        }
    }

    Ok(())
}

fn is_validation_mutation_statement(statement: &Statement) -> bool {
    let lowered = statement.to_string().to_lowercase();
    matches_validation_table(&lowered, "insert into ")
        || matches_validation_table(&lowered, "update ")
        || matches_validation_table(&lowered, "delete from ")
}

fn matches_validation_table(sql: &str, prefix: &str) -> bool {
    if !sql.starts_with(prefix) {
        return false;
    }

    let rest = sql[prefix.len()..].trim_start();
    starts_with_table_token(rest, "state") || starts_with_table_token(rest, "state_all")
}

fn starts_with_table_token(input: &str, table: &str) -> bool {
    if let Some(without_quote) = input.strip_prefix('"') {
        if let Some(after_name) = without_quote.strip_prefix(table) {
            return after_name.starts_with('"')
                && has_identifier_boundary(after_name.trim_start_matches('"'));
        }
    }

    if let Some(without_quote) = input.strip_prefix('`') {
        if let Some(after_name) = without_quote.strip_prefix(table) {
            return after_name.starts_with('`')
                && has_identifier_boundary(after_name.trim_start_matches('`'));
        }
    }

    if let Some(after_name) = input.strip_prefix(table) {
        return has_identifier_boundary(after_name);
    }

    false
}

fn has_identifier_boundary(input: &str) -> bool {
    match input.chars().next() {
        None => true,
        Some(next_char) => !next_char.is_ascii_alphanumeric() && next_char != '_',
    }
}

fn execute_plugin_change_detection(
    host: &dyn HostCallbacks,
    request_id: &str,
    requests: &[PluginChangeRequest],
) -> Result<Vec<Value>, EngineError> {
    let mut all_changes = Vec::new();

    for request in requests {
        let response = host
            .detect_changes(HostDetectChangesRequest {
                request_id: request_id.to_owned(),
                plugin_key: request.plugin_key.clone(),
                before: request.before.clone(),
                after: request.after.clone(),
            })
            .map_err(|error| map_host_error(error, LIX_RUST_DETECT_CHANGES))?;

        all_changes.extend(response.changes);
    }

    Ok(all_changes)
}

fn map_host_error(error: EngineError, default_code: &'static str) -> EngineError {
    if error.code == LIX_RUST_SQLITE_EXECUTION
        || error.code == LIX_RUST_DETECT_CHANGES
        || error.code == LIX_RUST_REWRITE_VALIDATION
        || error.code == LIX_RUST_UNSUPPORTED_SQLITE_FEATURE
        || error.code == LIX_RUST_PROTOCOL_MISMATCH
        || error.code == LIX_RUST_TIMEOUT
        || error.code == LIX_RUST_UNKNOWN
    {
        return error;
    }

    EngineError::new(default_code, error.message)
}

#[cfg(test)]
mod tests {
    use std::cell::RefCell;

    use serde_json::json;

    use super::{
        execute_with_host, plan_execute, route_statement_kind, EngineError, ExecuteRequest,
        HostCallbacks, HostDetectChangesRequest, HostDetectChangesResponse, HostExecuteRequest,
        HostExecuteResponse, PluginChangeRequest, LIX_RUST_DETECT_CHANGES,
        LIX_RUST_REWRITE_VALIDATION, LIX_RUST_SQLITE_EXECUTION, RUST_KIND_PASSTHROUGH,
        RUST_KIND_READ_REWRITE, RUST_KIND_VALIDATION, RUST_KIND_WRITE_REWRITE,
        RUST_ROWS_AFFECTED_ROWS_LENGTH, RUST_ROWS_AFFECTED_SQLITE_CHANGES,
    };

    #[derive(Default)]
    struct TestHost {
        execute_calls: RefCell<Vec<HostExecuteRequest>>,
        detect_calls: RefCell<Vec<HostDetectChangesRequest>>,
        execute_response: RefCell<Option<Result<HostExecuteResponse, EngineError>>>,
        detect_response: RefCell<Option<Result<HostDetectChangesResponse, EngineError>>>,
    }

    impl HostCallbacks for TestHost {
        fn execute(&self, request: HostExecuteRequest) -> Result<HostExecuteResponse, EngineError> {
            self.execute_calls.borrow_mut().push(request);
            self.execute_response
                .borrow_mut()
                .take()
                .unwrap_or_else(|| {
                    Ok(HostExecuteResponse {
                        rows: Vec::new(),
                        rows_affected: 0,
                        last_insert_row_id: None,
                    })
                })
        }

        fn detect_changes(
            &self,
            request: HostDetectChangesRequest,
        ) -> Result<HostDetectChangesResponse, EngineError> {
            self.detect_calls.borrow_mut().push(request);
            self.detect_response.borrow_mut().take().unwrap_or_else(|| {
                Ok(HostDetectChangesResponse {
                    changes: Vec::new(),
                })
            })
        }
    }

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

    #[test]
    fn executes_read_rewrite_with_rows_length_policy() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Ok(HostExecuteResponse {
                rows: vec![json!({ "value": 1 })],
                rows_affected: 99,
                last_insert_row_id: None,
            }))),
            ..Default::default()
        };

        let result = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-read".to_owned(),
                sql: "select 1 as value".to_owned(),
                params: vec![],
                plugin_change_requests: vec![],
            },
        )
        .expect("read execution should succeed");

        assert_eq!(result.statement_kind, RUST_KIND_READ_REWRITE);
        assert_eq!(result.rows_affected, 1);
        assert!(result.plugin_changes.is_empty());

        let calls = host.execute_calls.borrow();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].statement_kind, RUST_KIND_READ_REWRITE);
        assert_eq!(calls[0].sql, "select 1 as value");
        assert!(host.detect_calls.borrow().is_empty());
    }

    #[test]
    fn executes_write_rewrite_and_runs_plugin_change_detection() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Ok(HostExecuteResponse {
                rows: vec![],
                rows_affected: 2,
                last_insert_row_id: Some(10),
            }))),
            detect_response: RefCell::new(Some(Ok(HostDetectChangesResponse {
                changes: vec![json!({ "type": "file_update" })],
            }))),
            ..Default::default()
        };

        let result = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-write".to_owned(),
                sql: "insert into file (id) values ('x')".to_owned(),
                params: vec![],
                plugin_change_requests: vec![PluginChangeRequest {
                    plugin_key: "json".to_owned(),
                    before: vec![1],
                    after: vec![2],
                }],
            },
        )
        .expect("write execution should succeed");

        assert_eq!(result.statement_kind, RUST_KIND_WRITE_REWRITE);
        assert_eq!(result.rows_affected, 2);
        assert_eq!(result.last_insert_row_id, Some(10));
        assert_eq!(
            result.plugin_changes,
            vec![json!({ "type": "file_update" })]
        );

        assert_eq!(host.execute_calls.borrow().len(), 1);
        assert_eq!(host.detect_calls.borrow().len(), 1);
    }

    #[test]
    fn executes_validation_path_and_uses_sqlite_changes_policy() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Ok(HostExecuteResponse {
                rows: vec![json!({ "ignored": true })],
                rows_affected: 3,
                last_insert_row_id: None,
            }))),
            detect_response: RefCell::new(Some(Ok(HostDetectChangesResponse {
                changes: vec![json!({ "type": "state_commit" })],
            }))),
            ..Default::default()
        };

        let sql = "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values ('e', 'k', 'f', 'json', json('{}'), '1', json('{}'), 0)";
        let result = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-validation".to_owned(),
                sql: sql.to_owned(),
                params: vec![],
                plugin_change_requests: vec![PluginChangeRequest {
                    plugin_key: "json".to_owned(),
                    before: vec![],
                    after: vec![],
                }],
            },
        )
        .expect("validation execution should succeed");

        assert_eq!(result.statement_kind, RUST_KIND_VALIDATION);
        assert_eq!(result.rows_affected, 3);
        assert_eq!(
            result.plugin_changes,
            vec![json!({ "type": "state_commit" })]
        );
    }

    #[test]
    fn executes_passthrough_without_rewrite_or_detect_changes() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Ok(HostExecuteResponse {
                rows: vec![json!({ "user_version": 7 })],
                rows_affected: 42,
                last_insert_row_id: None,
            }))),
            ..Default::default()
        };

        let result = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-pass".to_owned(),
                sql: "pragma user_version".to_owned(),
                params: vec![],
                plugin_change_requests: vec![PluginChangeRequest {
                    plugin_key: "json".to_owned(),
                    before: vec![],
                    after: vec![],
                }],
            },
        )
        .expect("passthrough execution should succeed");

        assert_eq!(result.statement_kind, RUST_KIND_PASSTHROUGH);
        assert_eq!(result.rows_affected, 1);
        assert!(result.plugin_changes.is_empty());
        assert_eq!(host.execute_calls.borrow().len(), 1);
        assert!(host.detect_calls.borrow().is_empty());
    }

    #[test]
    fn maps_execute_failures_to_stable_sqlite_error_code() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Err(EngineError::new(
                "UNCLASSIFIED",
                "SQLITE_ERROR: no such table: missing",
            )))),
            ..Default::default()
        };

        let error = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-error".to_owned(),
                sql: "select * from missing".to_owned(),
                params: vec![],
                plugin_change_requests: vec![],
            },
        )
        .expect_err("execution should fail");

        assert_eq!(error.code, LIX_RUST_SQLITE_EXECUTION);
    }

    #[test]
    fn maps_detect_changes_failures_to_stable_error_code() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Ok(HostExecuteResponse {
                rows: vec![],
                rows_affected: 1,
                last_insert_row_id: None,
            }))),
            detect_response: RefCell::new(Some(Err(EngineError::new(
                "UNCLASSIFIED",
                "plugin failed",
            )))),
            ..Default::default()
        };

        let error = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-detect-error".to_owned(),
                sql: "insert into file (id) values ('x')".to_owned(),
                params: vec![],
                plugin_change_requests: vec![PluginChangeRequest {
                    plugin_key: "json".to_owned(),
                    before: vec![],
                    after: vec![],
                }],
            },
        )
        .expect_err("detect changes should fail");

        assert_eq!(error.code, LIX_RUST_DETECT_CHANGES);
    }

    #[test]
    fn returns_validation_error_for_non_state_validation_mutation() {
        let host = TestHost::default();

        let error = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-invalid-validation".to_owned(),
                sql: "update stateful set schema_key = 'x' where entity_id = 'e'".to_owned(),
                params: vec![],
                plugin_change_requests: vec![],
            },
        )
        .expect_err("invalid validation target should fail");

        assert_eq!(error.code, LIX_RUST_REWRITE_VALIDATION);
    }
}
