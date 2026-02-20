use cel_interpreter::Program;
use jsonschema::JSONSchema;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlparser::ast::{
    Delete, Expr, FromTable, FunctionArg, FunctionArgExpr, FunctionArguments, Ident, Insert,
    ObjectName, Query, Select, SetExpr, Statement, TableAlias, TableFactor, TableWithJoins,
};
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
const INTERNAL_STATE_VTABLE: &str = "lix_internal_state_vtable";
const STATE_BY_VERSION: &str = "state_by_version";
const STATE_VIEW: &str = "state";
const STATE_ALL_VIEW: &str = "state_all";
const MUTATION_ROW_CTE: &str = "__lix_mutation_rows";
const STATE_MUTATION_KEY_COLUMNS: [&str; 4] = ["entity_id", "schema_key", "file_id", "version_id"];

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

    if statement_kind == RUST_KIND_VALIDATION {
        validate_validation_mutations(&request.sql)?;
    }
    validate_state_mutation_rows(host, &request.sql, request.params.as_slice(), statement_kind)?;

    let rewritten_sql = rewrite_sql_for_execution(&request.sql, statement_kind)?;

    let should_detect_changes =
        should_run_plugin_change_detection(statement_kind, &request.sql, request.params.as_slice());

    let execute_response = host
        .execute(HostExecuteRequest {
            request_id: request.request_id.clone(),
            sql: rewritten_sql,
            params: request.params,
            statement_kind,
        })
        .map_err(|error| map_host_error(error, LIX_RUST_SQLITE_EXECUTION))?;

    let plugin_changes = if should_detect_changes {
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

pub fn rewrite_sql_for_execution(sql: &str, statement_kind: &str) -> Result<String, EngineError> {
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

    let mut rewritten_statements: Vec<String> = Vec::with_capacity(parsed.len());
    let mut changed = false;
    for statement in &parsed {
        let (rewritten, statement_changed) = match statement_kind {
            RUST_KIND_READ_REWRITE => {
                let mut statement_clone = statement.clone();
                let statement_changed = rewrite_statement_for_read_rewrite(&mut statement_clone)?;
                (statement_clone.to_string(), statement_changed)
            }
            RUST_KIND_WRITE_REWRITE | RUST_KIND_VALIDATION => {
                rewrite_statement_for_write_rewrite(statement)?
            }
            _ => (statement.to_string(), false),
        };
        rewritten_statements.push(rewritten);
        changed |= statement_changed;
    }

    if !changed {
        return Ok(sql.to_owned());
    }

    Ok(rewritten_statements.join("; "))
}

fn rewrite_statement_for_read_rewrite(statement: &mut Statement) -> Result<bool, EngineError> {
    match statement {
        Statement::Query(query) => rewrite_query_for_read_rewrite(query),
        _ => Ok(false),
    }
}

fn rewrite_query_for_read_rewrite(query: &mut Query) -> Result<bool, EngineError> {
    let mut changed = false;

    if let Some(with_clause) = &mut query.with {
        for cte in &mut with_clause.cte_tables {
            changed |= rewrite_query_for_read_rewrite(&mut cte.query)?;
        }
    }

    changed |= rewrite_set_expr_for_read_rewrite(&mut query.body)?;
    Ok(changed)
}

fn rewrite_set_expr_for_read_rewrite(set_expr: &mut SetExpr) -> Result<bool, EngineError> {
    match set_expr {
        SetExpr::Select(select) => rewrite_select_for_read_rewrite(select),
        SetExpr::Query(query) => rewrite_query_for_read_rewrite(query),
        SetExpr::SetOperation { left, right, .. } => {
            let left_changed = rewrite_set_expr_for_read_rewrite(left)?;
            let right_changed = rewrite_set_expr_for_read_rewrite(right)?;
            Ok(left_changed || right_changed)
        }
        _ => Ok(false),
    }
}

fn rewrite_select_for_read_rewrite(select: &mut Select) -> Result<bool, EngineError> {
    let mut changed = false;
    for table_with_joins in &mut select.from {
        changed |= rewrite_table_with_joins_for_read_rewrite(table_with_joins)?;
    }
    Ok(changed)
}

fn rewrite_table_with_joins_for_read_rewrite(
    table_with_joins: &mut TableWithJoins,
) -> Result<bool, EngineError> {
    let mut changed = rewrite_table_factor_for_read_rewrite(&mut table_with_joins.relation)?;

    for join in &mut table_with_joins.joins {
        changed |= rewrite_table_factor_for_read_rewrite(&mut join.relation)?;
    }

    Ok(changed)
}

fn rewrite_table_factor_for_read_rewrite(
    table_factor: &mut TableFactor,
) -> Result<bool, EngineError> {
    match table_factor {
        TableFactor::Table {
            name, alias, args, ..
        } => {
            if args.is_some() || !is_target_vtable_name(name) {
                return Ok(false);
            }

            let subquery = build_state_vtable_equivalent_subquery()?;
            let derived_alias = alias.take().unwrap_or_else(|| TableAlias {
                name: Ident::new(INTERNAL_STATE_VTABLE),
                columns: Vec::new(),
            });
            *table_factor = TableFactor::Derived {
                lateral: false,
                subquery: Box::new(subquery),
                alias: Some(derived_alias),
            };
            Ok(true)
        }
        TableFactor::Derived { subquery, .. } => rewrite_query_for_read_rewrite(subquery),
        TableFactor::NestedJoin {
            table_with_joins, ..
        } => rewrite_table_with_joins_for_read_rewrite(table_with_joins),
        TableFactor::Pivot { table, .. } => rewrite_table_factor_for_read_rewrite(table),
        TableFactor::Unpivot { table, .. } => rewrite_table_factor_for_read_rewrite(table),
        TableFactor::MatchRecognize { table, .. } => rewrite_table_factor_for_read_rewrite(table),
        _ => Ok(false),
    }
}

fn is_target_vtable_name(name: &ObjectName) -> bool {
    name.0
        .last()
        .map(|part| part.value.eq_ignore_ascii_case(INTERNAL_STATE_VTABLE))
        .unwrap_or(false)
}

fn build_state_vtable_equivalent_subquery() -> Result<Query, EngineError> {
    let dialect = SQLiteDialect {};
    let statements = Parser::parse_sql(
        &dialect,
        "SELECT \
            entity_id, \
            schema_key, \
            file_id, \
            version_id, \
            plugin_key, \
            snapshot_content, \
            schema_version, \
            created_at, \
            updated_at, \
            inherited_from_version_id, \
            NULL AS change_id, \
            1 AS untracked, \
            NULL AS commit_id, \
            NULL AS writer_key, \
            NULL AS metadata \
        FROM lix_internal_state_all_untracked",
    )
    .map_err(|error| {
        EngineError::protocol_mismatch(format!(
            "failed to construct read rewrite for {INTERNAL_STATE_VTABLE}: {error}"
        ))
    })?;

    let statement = statements.into_iter().next().ok_or_else(|| {
        EngineError::protocol_mismatch(format!(
            "missing read rewrite statement for {INTERNAL_STATE_VTABLE}"
        ))
    })?;

    match statement {
        Statement::Query(query) => Ok(*query),
        _ => Err(EngineError::protocol_mismatch(format!(
            "read rewrite query for {INTERNAL_STATE_VTABLE} must be a SELECT"
        ))),
    }
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
    match statement {
        Statement::Insert(insert) => is_validation_target_name(&insert.table_name),
        Statement::Update { table, .. } => {
            let TableFactor::Table { name, .. } = &table.relation else {
                return false;
            };
            is_validation_target_name(name)
        }
        Statement::Delete(delete) => {
            let tables = match &delete.from {
                FromTable::WithFromKeyword(value) => value,
                FromTable::WithoutKeyword(value) => value,
            };
            let Some(first) = tables.first() else {
                return false;
            };
            let TableFactor::Table { name, .. } = &first.relation else {
                return false;
            };
            is_validation_target_name(name)
        }
        _ => false,
    }
}

fn is_validation_target_name(name: &ObjectName) -> bool {
    matches!(
        classify_write_target(name),
        WriteTarget::State
            | WriteTarget::StateAll
            | WriteTarget::StateByVersion
            | WriteTarget::StateVtable
    )
}

#[derive(Debug, Clone)]
struct MutationValidationRow {
    schema_key: String,
    schema_version: String,
    snapshot_content: Value,
}

fn validate_state_mutation_rows(
    host: &dyn HostCallbacks,
    sql: &str,
    params: &[Value],
    statement_kind: &str,
) -> Result<(), EngineError> {
    let should_validate = statement_kind == RUST_KIND_VALIDATION
        || (statement_kind == RUST_KIND_WRITE_REWRITE && might_mutate_state_tables(sql));
    if !should_validate {
        return Ok(());
    }

    let dialect = SQLiteDialect {};
    let statements = Parser::parse_sql(&dialect, sql).map_err(|error| {
        EngineError::rewrite_validation(format!("failed to parse mutation SQL for validation: {error}"))
    })?;

    let mut param_cursor: usize = 0;
    for statement in &statements {
        let mut rows = extract_insert_validation_rows(statement, params, &mut param_cursor)?;
        for row in rows.drain(..) {
            validate_single_mutation_row(host, &row)?;
        }
    }

    Ok(())
}

fn might_mutate_state_tables(sql: &str) -> bool {
    let lowered = sql.to_lowercase();
    lowered.contains("insert into state")
        || lowered.contains("insert into state_by_version")
        || lowered.contains("insert into state_all")
        || lowered.contains("insert into lix_internal_state_vtable")
        || lowered.contains("update state")
        || lowered.contains("update state_by_version")
        || lowered.contains("update state_all")
        || lowered.contains("update lix_internal_state_vtable")
        || lowered.contains("delete from state")
        || lowered.contains("delete from state_by_version")
        || lowered.contains("delete from state_all")
        || lowered.contains("delete from lix_internal_state_vtable")
}

fn extract_insert_validation_rows(
    statement: &Statement,
    params: &[Value],
    param_cursor: &mut usize,
) -> Result<Vec<MutationValidationRow>, EngineError> {
    let Statement::Insert(insert) = statement else {
        return Ok(Vec::new());
    };

    if !is_validation_target_name(&insert.table_name) {
        return Ok(Vec::new());
    }

    let Some(source) = &insert.source else {
        return Ok(Vec::new());
    };
    let SetExpr::Values(values) = &*source.body else {
        return Ok(Vec::new());
    };

    let column_names: Vec<String> = if insert.columns.is_empty() {
        vec![
            "entity_id".to_owned(),
            "schema_key".to_owned(),
            "file_id".to_owned(),
            "plugin_key".to_owned(),
            "snapshot_content".to_owned(),
            "schema_version".to_owned(),
            "metadata".to_owned(),
            "untracked".to_owned(),
            "version_id".to_owned(),
        ]
    } else {
        insert
            .columns
            .iter()
            .map(|ident| ident.value.to_lowercase())
            .collect()
    };

    let schema_key_idx = column_names
        .iter()
        .position(|name| name == "schema_key")
        .ok_or_else(|| {
            EngineError::rewrite_validation("state mutation missing required schema_key column")
        })?;
    let schema_version_idx = column_names
        .iter()
        .position(|name| name == "schema_version")
        .ok_or_else(|| {
            EngineError::rewrite_validation("state mutation missing required schema_version column")
        })?;
    let snapshot_idx = column_names
        .iter()
        .position(|name| name == "snapshot_content")
        .ok_or_else(|| {
            EngineError::rewrite_validation("state mutation missing required snapshot_content column")
        })?;

    let mut result = Vec::with_capacity(values.rows.len());
    for row in &values.rows {
        if row.len() != column_names.len() {
            return Err(EngineError::rewrite_validation(
                "insert row shape does not match declared columns",
            ));
        }

        let schema_key =
            evaluate_sql_expr_to_json(&row[schema_key_idx], params, param_cursor, false)?;
        let schema_version = evaluate_sql_expr_to_json(
            &row[schema_version_idx],
            params,
            param_cursor,
            false,
        )?;
        let snapshot_content =
            evaluate_sql_expr_to_json(&row[snapshot_idx], params, param_cursor, true)?;

        let schema_key = schema_key.as_str().ok_or_else(|| {
            EngineError::rewrite_validation("schema_key must resolve to a string")
        })?;
        let schema_version = schema_version.as_str().ok_or_else(|| {
            EngineError::rewrite_validation("schema_version must resolve to a string")
        })?;

        result.push(MutationValidationRow {
            schema_key: schema_key.to_owned(),
            schema_version: schema_version.to_owned(),
            snapshot_content,
        });
    }

    Ok(result)
}

fn evaluate_sql_expr_to_json(
    expr: &Expr,
    params: &[Value],
    param_cursor: &mut usize,
    parse_json_strings: bool,
) -> Result<Value, EngineError> {
    match expr {
        Expr::Value(value) => convert_sql_value_to_json(value, params, param_cursor, parse_json_strings),
        Expr::Function(function) => {
            let function_name = function.name.to_string().to_lowercase();
            if function_name == "json" {
                let FunctionArguments::List(argument_list) = &function.args else {
                    return Err(EngineError::rewrite_validation(
                        "json(...) requires an argument list",
                    ));
                };
                if argument_list.args.len() != 1 {
                    return Err(EngineError::rewrite_validation(
                        "json(...) requires exactly one argument",
                    ));
                }
                let FunctionArg::Unnamed(FunctionArgExpr::Expr(inner)) = &argument_list.args[0]
                else {
                    return Err(EngineError::rewrite_validation(
                        "json(...) only supports expression arguments in Rust validation",
                    ));
                };
                let value = evaluate_sql_expr_to_json(inner, params, param_cursor, true)?;
                return Ok(value);
            }

            Err(EngineError::rewrite_validation(format!(
                "unsupported SQL function in state validation mutation: {function_name}"
            )))
        }
        _ => Err(EngineError::rewrite_validation(format!(
            "unsupported SQL expression in validation mutation: {expr}"
        ))),
    }
}

fn convert_sql_value_to_json(
    value: &sqlparser::ast::Value,
    params: &[Value],
    param_cursor: &mut usize,
    parse_json_strings: bool,
) -> Result<Value, EngineError> {
    match value {
        sqlparser::ast::Value::SingleQuotedString(text)
        | sqlparser::ast::Value::DoubleQuotedString(text)
        | sqlparser::ast::Value::TripleSingleQuotedString(text)
        | sqlparser::ast::Value::TripleDoubleQuotedString(text)
        | sqlparser::ast::Value::EscapedStringLiteral(text)
        | sqlparser::ast::Value::UnicodeStringLiteral(text)
        | sqlparser::ast::Value::NationalStringLiteral(text) => {
            if parse_json_strings {
                serde_json::from_str::<Value>(text).map_err(|error| {
                    EngineError::rewrite_validation(format!(
                        "failed to parse JSON snapshot content: {error}"
                    ))
                })
            } else {
                Ok(Value::String(text.clone()))
            }
        }
        sqlparser::ast::Value::Number(number, _) => {
            if let Ok(parsed) = number.parse::<i64>() {
                return Ok(Value::Number(parsed.into()));
            }
            if let Ok(parsed) = number.parse::<f64>() {
                if let Some(json_number) = serde_json::Number::from_f64(parsed) {
                    return Ok(Value::Number(json_number));
                }
            }
            Err(EngineError::rewrite_validation(format!(
                "unsupported numeric literal in validation mutation: {number}"
            )))
        }
        sqlparser::ast::Value::Boolean(boolean) => Ok(Value::Bool(*boolean)),
        sqlparser::ast::Value::Null => Ok(Value::Null),
        sqlparser::ast::Value::Placeholder(_) => {
            let Some(bound) = params.get(*param_cursor) else {
                return Err(EngineError::rewrite_validation(
                    "not enough SQL parameters for validation mutation",
                ));
            };
            *param_cursor += 1;
            if parse_json_strings {
                if let Value::String(text) = bound {
                    if let Ok(parsed) = serde_json::from_str::<Value>(text) {
                        return Ok(parsed);
                    }
                }
            }
            Ok(bound.clone())
        }
        _ => Err(EngineError::rewrite_validation(format!(
            "unsupported SQL literal in validation mutation: {value}"
        ))),
    }
}

fn validate_single_mutation_row(
    host: &dyn HostCallbacks,
    row: &MutationValidationRow,
) -> Result<(), EngineError> {
    let schema = fetch_stored_schema(host, &row.schema_key, &row.schema_version)?;
    validate_cel_expressions_in_schema(&schema)?;
    let compiled = JSONSchema::compile(&schema).map_err(|error| {
        EngineError::rewrite_validation(format!(
            "failed to compile schema {}@{}: {error}",
            row.schema_key, row.schema_version
        ))
    })?;
    if let Err(mut errors) = compiled.validate(&row.snapshot_content) {
        let detail = errors
            .next()
            .map(|error| error.to_string())
            .unwrap_or_else(|| "unknown validation failure".to_owned());
        return Err(EngineError::rewrite_validation(format!(
            "snapshot for {}@{} failed JSON Schema validation: {detail}",
            row.schema_key, row.schema_version
        )));
    }
    Ok(())
}

fn fetch_stored_schema(
    host: &dyn HostCallbacks,
    schema_key: &str,
    schema_version: &str,
) -> Result<Value, EngineError> {
    let sql = "SELECT value FROM stored_schema \
               WHERE json_extract(value, '$.\"x-lix-key\"') = ? \
               AND json_extract(value, '$.\"x-lix-version\"') = ? \
               ORDER BY rowid DESC LIMIT 1";
    let response = host
        .execute(HostExecuteRequest {
            request_id: "rust-validation-schema-load".to_owned(),
            sql: sql.to_owned(),
            params: vec![
                Value::String(schema_key.to_owned()),
                Value::String(schema_version.to_owned()),
            ],
            statement_kind: RUST_KIND_PASSTHROUGH,
        })
        .map_err(|error| map_host_error(error, LIX_RUST_REWRITE_VALIDATION))?;

    let Some(first_row) = response.rows.first() else {
        return Err(EngineError::rewrite_validation(format!(
            "schema {}@{} is not stored",
            schema_key, schema_version
        )));
    };

    match first_row {
        Value::Object(record) => {
            let Some(value) = record.get("value") else {
                return Err(EngineError::rewrite_validation(
                    "stored_schema row missing 'value' column",
                ));
            };
            if let Value::String(text) = value {
                serde_json::from_str::<Value>(text).map_err(|error| {
                    EngineError::rewrite_validation(format!(
                        "stored schema payload is not valid JSON: {error}"
                    ))
                })
            } else {
                Ok(value.clone())
            }
        }
        Value::String(text) => serde_json::from_str::<Value>(text).map_err(|error| {
            EngineError::rewrite_validation(format!(
                "stored schema payload is not valid JSON: {error}"
            ))
        }),
        _ => Err(EngineError::rewrite_validation(
            "stored schema query returned an unsupported row shape",
        )),
    }
}

fn validate_cel_expressions_in_schema(schema: &Value) -> Result<(), EngineError> {
    match schema {
        Value::Object(record) => {
            if let Some(Value::String(expression)) = record.get("x-lix-default") {
                Program::compile(expression).map_err(|error| {
                    EngineError::rewrite_validation(format!(
                        "invalid CEL expression in x-lix-default: {error}"
                    ))
                })?;
            }
            if let Some(Value::Object(overrides)) = record.get("x-lix-override-lixcols") {
                for (key, value) in overrides {
                    if let Value::String(expression) = value {
                        Program::compile(expression).map_err(|error| {
                            EngineError::rewrite_validation(format!(
                                "invalid CEL expression in x-lix-override-lixcols.{key}: {error}"
                            ))
                        })?;
                    }
                }
            }
            for value in record.values() {
                validate_cel_expressions_in_schema(value)?;
            }
            Ok(())
        }
        Value::Array(values) => {
            for value in values {
                validate_cel_expressions_in_schema(value)?;
            }
            Ok(())
        }
        _ => Ok(()),
    }
}

fn rewrite_statement_for_write_rewrite(
    statement: &Statement,
) -> Result<(String, bool), EngineError> {
    let rewritten = match statement {
        Statement::Insert(insert) => rewrite_insert_for_write_rewrite(insert)?,
        Statement::Update {
            table,
            assignments,
            from,
            selection,
            returning,
            ..
        } => rewrite_update_for_write_rewrite(
            table,
            assignments.as_slice(),
            from,
            selection,
            returning,
        ),
        Statement::Delete(delete) => rewrite_delete_for_write_rewrite(delete),
        _ => None,
    };

    if let Some(sql) = rewritten {
        Ok((sql, true))
    } else {
        Ok((statement.to_string(), false))
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WriteTarget {
    State,
    StateAll,
    StateByVersion,
    StateVtable,
    Other,
}

fn classify_write_target(name: &ObjectName) -> WriteTarget {
    let Some(last) = name.0.last() else {
        return WriteTarget::Other;
    };
    let value = last.value.as_str();
    if value.eq_ignore_ascii_case(STATE_VIEW) {
        return WriteTarget::State;
    }
    if value.eq_ignore_ascii_case(STATE_ALL_VIEW) {
        return WriteTarget::StateAll;
    }
    if value.eq_ignore_ascii_case(STATE_BY_VERSION) {
        return WriteTarget::StateByVersion;
    }
    if value.eq_ignore_ascii_case(INTERNAL_STATE_VTABLE) {
        return WriteTarget::StateVtable;
    }
    WriteTarget::Other
}

fn resolve_physical_target(target: WriteTarget) -> Option<&'static str> {
    match target {
        WriteTarget::State | WriteTarget::StateAll | WriteTarget::StateByVersion => {
            Some(STATE_BY_VERSION)
        }
        WriteTarget::StateVtable => Some(INTERNAL_STATE_VTABLE),
        WriteTarget::Other => None,
    }
}

fn rewrite_insert_for_write_rewrite(insert: &Insert) -> Result<Option<String>, EngineError> {
    if insert.on.is_some()
        || insert.returning.is_some()
        || insert.partitioned.is_some()
        || !insert.after_columns.is_empty()
        || insert.table_alias.is_some()
    {
        return Ok(None);
    }

    let target_kind = classify_write_target(&insert.table_name);
    let Some(target_table) = resolve_physical_target(target_kind) else {
        return Ok(None);
    };

    let Some(source) = &insert.source else {
        return Ok(None);
    };

    let SetExpr::Values(values) = &*source.body else {
        return Ok(None);
    };

    if insert.columns.is_empty() {
        return Ok(None);
    }

    let mut materialized_columns: Vec<String> = insert
        .columns
        .iter()
        .map(|column| column.value.clone())
        .collect();
    let needs_active_version = target_kind == WriteTarget::State
        && !materialized_columns
            .iter()
            .any(|column| column.eq_ignore_ascii_case("version_id"));
    if needs_active_version {
        materialized_columns.push("version_id".to_owned());
    }

    let mut rendered_rows: Vec<String> = Vec::with_capacity(values.rows.len());
    for row in &values.rows {
        if row.len() != insert.columns.len() {
            return Err(EngineError::protocol_mismatch(
                "insert row shape does not match declared columns",
            ));
        }

        let mut rendered_exprs: Vec<String> = row.iter().map(ToString::to_string).collect();
        if needs_active_version {
            rendered_exprs.push("(SELECT version_id FROM active_version)".to_owned());
        }
        rendered_rows.push(format!("({})", rendered_exprs.join(", ")));
    }

    let materialized_columns_sql = materialized_columns
        .iter()
        .map(|column| quote_ident(column))
        .collect::<Vec<String>>()
        .join(", ");

    let sql = format!(
        "WITH \"{MUTATION_ROW_CTE}\" ({materialized_columns_sql}) AS (VALUES {}) \
         INSERT INTO {target_table} ({materialized_columns_sql}) \
         SELECT {materialized_columns_sql} FROM \"{MUTATION_ROW_CTE}\"",
        rendered_rows.join(", ")
    );

    Ok(Some(sql))
}

fn rewrite_update_for_write_rewrite(
    table: &TableWithJoins,
    assignments: &[sqlparser::ast::Assignment],
    from: &Option<TableWithJoins>,
    selection: &Option<sqlparser::ast::Expr>,
    returning: &Option<Vec<sqlparser::ast::SelectItem>>,
) -> Option<String> {
    if table.joins.len() > 0 || from.is_some() || returning.is_some() {
        return None;
    }
    let TableFactor::Table {
        name, alias, args, ..
    } = &table.relation
    else {
        return None;
    };

    if alias.is_some() || args.is_some() {
        return None;
    }

    let target_kind = classify_write_target(name);
    let target_table = resolve_physical_target(target_kind)?;

    let predicate = combine_write_predicate(selection, target_kind);
    let assignments_sql = assignments
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<String>>()
        .join(", ");

    let key_columns_sql = STATE_MUTATION_KEY_COLUMNS.join(", ");
    let where_clause = match predicate {
        Some(predicate_sql) => format!(" WHERE {predicate_sql}"),
        None => String::new(),
    };

    Some(format!(
        "WITH \"{MUTATION_ROW_CTE}\" AS (\
            SELECT {key_columns_sql} \
            FROM {target_table}{where_clause} \
            ORDER BY {key_columns_sql}\
        ) \
        UPDATE {target_table} \
        SET {assignments_sql} \
        WHERE ({key_columns_sql}) IN (\
            SELECT {key_columns_sql} FROM \"{MUTATION_ROW_CTE}\"\
        )"
    ))
}

fn rewrite_delete_for_write_rewrite(delete: &Delete) -> Option<String> {
    if !delete.tables.is_empty()
        || delete.using.is_some()
        || delete.returning.is_some()
        || !delete.order_by.is_empty()
        || delete.limit.is_some()
    {
        return None;
    }

    let tables = match &delete.from {
        FromTable::WithFromKeyword(value) => value,
        FromTable::WithoutKeyword(value) => value,
    };
    if tables.len() != 1 {
        return None;
    }

    let table_with_joins = tables.first()?;
    if !table_with_joins.joins.is_empty() {
        return None;
    }

    let TableFactor::Table {
        name, alias, args, ..
    } = &table_with_joins.relation
    else {
        return None;
    };
    if alias.is_some() || args.is_some() {
        return None;
    }

    let target_kind = classify_write_target(name);
    let target_table = resolve_physical_target(target_kind)?;
    let predicate = combine_write_predicate(&delete.selection, target_kind);
    let key_columns_sql = STATE_MUTATION_KEY_COLUMNS.join(", ");
    let where_clause = match predicate {
        Some(predicate_sql) => format!(" WHERE {predicate_sql}"),
        None => String::new(),
    };

    Some(format!(
        "WITH \"{MUTATION_ROW_CTE}\" AS (\
            SELECT {key_columns_sql} \
            FROM {target_table}{where_clause} \
            ORDER BY {key_columns_sql}\
        ) \
        DELETE FROM {target_table} \
        WHERE ({key_columns_sql}) IN (\
            SELECT {key_columns_sql} FROM \"{MUTATION_ROW_CTE}\"\
        )"
    ))
}

fn combine_write_predicate(
    selection: &Option<sqlparser::ast::Expr>,
    target: WriteTarget,
) -> Option<String> {
    let active_version_filter = "version_id IN (SELECT version_id FROM active_version)";

    let selection_sql = selection.as_ref().map(ToString::to_string);

    if target == WriteTarget::State {
        return match selection_sql {
            Some(sql) => Some(format!("({sql}) AND ({active_version_filter})")),
            None => Some(active_version_filter.to_owned()),
        };
    }

    selection_sql
}

fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
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

fn should_run_plugin_change_detection(statement_kind: &str, sql: &str, params: &[Value]) -> bool {
    if statement_kind != RUST_KIND_WRITE_REWRITE && statement_kind != RUST_KIND_VALIDATION {
        return false;
    }

    let lowered = sql.to_lowercase();
    if lowered.contains("insert into file")
        || lowered.contains("update file")
        || lowered.contains("delete from file")
    {
        return true;
    }

    let mutates_state = lowered.contains("insert into state")
        || lowered.contains("insert into state_by_version")
        || lowered.contains("insert into lix_internal_state_vtable")
        || lowered.contains("update state")
        || lowered.contains("update state_by_version")
        || lowered.contains("update lix_internal_state_vtable")
        || lowered.contains("delete from state")
        || lowered.contains("delete from state_by_version")
        || lowered.contains("delete from lix_internal_state_vtable");
    if !mutates_state {
        return false;
    }

    if lowered.contains("lix_file") {
        return true;
    }

    params.iter().any(|value| match value {
        Value::String(text) => text == "lix_file",
        _ => false,
    })
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

    use serde_json::{json, Value};

    use super::{
        execute_with_host, plan_execute, rewrite_sql_for_execution, route_statement_kind,
        EngineError, ExecuteRequest, HostCallbacks, HostDetectChangesRequest,
        HostDetectChangesResponse, HostExecuteRequest, HostExecuteResponse, PluginChangeRequest,
        LIX_RUST_DETECT_CHANGES, LIX_RUST_REWRITE_VALIDATION, LIX_RUST_SQLITE_EXECUTION,
        RUST_KIND_PASSTHROUGH, RUST_KIND_READ_REWRITE, RUST_KIND_VALIDATION,
        RUST_KIND_WRITE_REWRITE, RUST_ROWS_AFFECTED_ROWS_LENGTH, RUST_ROWS_AFFECTED_SQLITE_CHANGES,
    };

    #[derive(Default)]
    struct TestHost {
        execute_calls: RefCell<Vec<HostExecuteRequest>>,
        detect_calls: RefCell<Vec<HostDetectChangesRequest>>,
        execute_response: RefCell<Option<Result<HostExecuteResponse, EngineError>>>,
        detect_response: RefCell<Option<Result<HostDetectChangesResponse, EngineError>>>,
    }

    struct ValidationHost {
        execute_calls: RefCell<Vec<HostExecuteRequest>>,
        schema_value: Value,
    }

    impl HostCallbacks for ValidationHost {
        fn execute(&self, request: HostExecuteRequest) -> Result<HostExecuteResponse, EngineError> {
            self.execute_calls.borrow_mut().push(request.clone());
            if request.sql.to_lowercase().contains("from stored_schema") {
                return Ok(HostExecuteResponse {
                    rows: vec![json!({ "value": self.schema_value.clone() })],
                    rows_affected: 1,
                    last_insert_row_id: None,
                });
            }
            Ok(HostExecuteResponse {
                rows: vec![],
                rows_affected: 1,
                last_insert_row_id: None,
            })
        }

        fn detect_changes(
            &self,
            _request: HostDetectChangesRequest,
        ) -> Result<HostDetectChangesResponse, EngineError> {
            Ok(HostDetectChangesResponse {
                changes: Vec::new(),
            })
        }
    }

    impl HostCallbacks for TestHost {
        fn execute(&self, request: HostExecuteRequest) -> Result<HostExecuteResponse, EngineError> {
            let is_schema_query = request.sql.to_lowercase().contains("from stored_schema");
            self.execute_calls.borrow_mut().push(request);
            if is_schema_query {
                return Ok(HostExecuteResponse {
                    rows: vec![json!({
                        "value": {
                            "type": "object",
                            "x-lix-key": "mock_schema",
                            "x-lix-version": "1.0",
                            "additionalProperties": true
                        }
                    })],
                    rows_affected: 1,
                    last_insert_row_id: None,
                });
            }
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
    fn rewrites_state_vtable_selects_to_derived_query() {
        let rewritten = rewrite_sql_for_execution(
            "select entity_id from lix_internal_state_vtable where schema_key = 'lix_active_version'",
            RUST_KIND_READ_REWRITE,
        )
        .expect("read rewrite should succeed");

        let normalized = rewritten.to_lowercase();
        assert!(normalized.contains("from (select"));
        assert!(normalized.contains("from lix_internal_state_all_untracked"));
        assert!(normalized.contains("as lix_internal_state_vtable"));
    }

    #[test]
    fn rewrites_state_vtable_selects_with_alias() {
        let rewritten = rewrite_sql_for_execution(
            "select v.entity_id from lix_internal_state_vtable as v",
            RUST_KIND_READ_REWRITE,
        )
        .expect("read rewrite with alias should succeed");

        let normalized = rewritten.to_lowercase();
        assert!(normalized.contains("as v"));
        assert!(normalized.contains("from lix_internal_state_all_untracked"));
    }

    #[test]
    fn preserves_non_vtable_read_sql() {
        let sql = "select id, path from file order by id limit 1";
        let rewritten =
            rewrite_sql_for_execution(sql, RUST_KIND_READ_REWRITE).expect("rewrite should work");
        assert_eq!(rewritten, sql);
    }

    #[test]
    fn rewrites_state_insert_with_materialized_rows() {
        let sql = "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values ('e1', 'k', 'f1', 'json', json('{}'), '1', json('{}'), 0), ('e2', 'k', 'f2', 'json', json('{}'), '1', json('{}'), 1)";
        let rewritten =
            rewrite_sql_for_execution(sql, RUST_KIND_VALIDATION).expect("rewrite should work");
        let normalized = rewritten.to_lowercase();
        assert!(normalized.contains("with \"__lix_mutation_rows\""));
        assert!(normalized.contains("insert into state_by_version"));
        assert!(normalized.contains("select version_id from active_version"));
        assert!(normalized.contains("select \"entity_id\""));
    }

    #[test]
    fn rewrites_state_update_to_deterministic_cte() {
        let sql = "update state set snapshot_content = json('{\"value\":2}'), untracked = 1 where schema_key = 'lix_key_value'";
        let rewritten =
            rewrite_sql_for_execution(sql, RUST_KIND_VALIDATION).expect("rewrite should work");
        let normalized = rewritten.to_lowercase();
        assert!(normalized.contains("with \"__lix_mutation_rows\" as"));
        assert!(normalized.contains("from state_by_version where (schema_key = 'lix_key_value') and (version_id in (select version_id from active_version))"));
        assert!(normalized.contains("order by entity_id, schema_key, file_id, version_id"));
        assert!(normalized.contains(
            "update state_by_version set snapshot_content = json('{\"value\":2}'), untracked = 1"
        ));
    }

    #[test]
    fn rewrites_state_by_version_delete_to_deterministic_cte() {
        let sql =
            "delete from state_by_version where version_id = 'global' and schema_key = 'lix_file'";
        let rewritten =
            rewrite_sql_for_execution(sql, RUST_KIND_WRITE_REWRITE).expect("rewrite should work");
        let normalized = rewritten.to_lowercase();
        assert!(normalized.contains("with \"__lix_mutation_rows\" as"));
        assert!(normalized.contains(
            "from state_by_version where version_id = 'global' and schema_key = 'lix_file'"
        ));
        assert!(normalized.contains("order by entity_id, schema_key, file_id, version_id"));
        assert!(normalized.contains("delete from state_by_version"));
        assert!(normalized.contains("where (entity_id, schema_key, file_id, version_id) in"));
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
        assert!(result.plugin_changes.is_empty());
        assert!(host.detect_calls.borrow().is_empty());
    }

    #[test]
    fn executes_validation_detect_changes_for_lix_file_mutations() {
        let host = TestHost {
            execute_response: RefCell::new(Some(Ok(HostExecuteResponse {
                rows: vec![],
                rows_affected: 1,
                last_insert_row_id: None,
            }))),
            detect_response: RefCell::new(Some(Ok(HostDetectChangesResponse {
                changes: vec![json!({ "type": "file_state_change" })],
            }))),
            ..Default::default()
        };

        let sql = "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values (?, ?, ?, ?, json('{}'), ?, json('{}'), 0)";
        let result = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-validation-file".to_owned(),
                sql: sql.to_owned(),
                params: vec![
                    json!("e"),
                    json!("lix_file"),
                    json!("f"),
                    json!("json"),
                    json!("1"),
                ],
                plugin_change_requests: vec![PluginChangeRequest {
                    plugin_key: "json".to_owned(),
                    before: vec![],
                    after: vec![],
                }],
            },
        )
        .expect("validation execution should succeed");

        assert_eq!(
            result.plugin_changes,
            vec![json!({ "type": "file_state_change" })]
        );
        assert_eq!(host.detect_calls.borrow().len(), 1);
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

    #[test]
    fn returns_validation_error_for_snapshot_schema_violation() {
        let schema = json!({
            "type": "object",
            "x-lix-key": "mock_schema",
            "x-lix-version": "1.0",
            "properties": {
                "name": { "type": "string" }
            },
            "required": ["name"],
            "additionalProperties": false
        });
        let host = ValidationHost {
            execute_calls: RefCell::new(Vec::new()),
            schema_value: schema,
        };

        let sql = "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values ('e', 'mock_schema', 'f', 'json', json('{\"count\":1}'), '1.0', json('{}'), 0)";
        let error = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-schema-invalid".to_owned(),
                sql: sql.to_owned(),
                params: vec![],
                plugin_change_requests: vec![],
            },
        )
        .expect_err("invalid snapshot should fail validation");

        assert_eq!(error.code, LIX_RUST_REWRITE_VALIDATION);
    }

    #[test]
    fn returns_validation_error_for_invalid_cel_in_schema() {
        let schema = json!({
            "type": "object",
            "x-lix-key": "mock_schema",
            "x-lix-version": "1.0",
            "properties": {
                "name": {
                    "type": "string",
                    "x-lix-default": "1 +"
                }
            },
            "additionalProperties": false
        });
        let host = ValidationHost {
            execute_calls: RefCell::new(Vec::new()),
            schema_value: schema,
        };

        let sql = "insert into state (entity_id, schema_key, file_id, plugin_key, snapshot_content, schema_version, metadata, untracked) values ('e', 'mock_schema', 'f', 'json', json('{\"name\":\"ok\"}'), '1.0', json('{}'), 0)";
        let error = execute_with_host(
            &host,
            ExecuteRequest {
                request_id: "req-cel-invalid".to_owned(),
                sql: sql.to_owned(),
                params: vec![],
                plugin_change_requests: vec![],
            },
        )
        .expect_err("invalid CEL expression should fail validation");

        assert_eq!(error.code, LIX_RUST_REWRITE_VALIDATION);
    }
}
