//! Agent graph-state restoration compatibility and defaults.

use serde_json::{json, Map, Value};

const SERIALIZATION_VERSION: &str = "1.0.0";

fn is_number(value: Option<&Value>) -> bool {
    value.is_some_and(Value::is_number)
}

fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::String(value) => value.clone(),
        Value::Array(values) => values
            .iter()
            .map(|value| {
                if value.is_null() {
                    String::new()
                } else {
                    js_string(value)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
        _ => value.to_string(),
    }
}

fn js_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(value) => *value,
        Value::Number(value) => value.as_f64().is_some_and(|value| value != 0.0),
        Value::String(value) => !value.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

fn compatibility(state: &Value, current_version: &str) -> (bool, Vec<String>) {
    let mut warnings = Vec::new();
    match state.get("serializationVersion") {
        None => warnings.push(
            "Restored state is missing serializationVersion — may have been saved by an older version of EverFern".into(),
        ),
        Some(version) if !js_truthy(version) => warnings.push(
            "Restored state is missing serializationVersion — may have been saved by an older version of EverFern".into(),
        ),
        Some(version) if version.as_str() != Some(current_version) => warnings.push(format!(
            "State was serialized with version {} but current version is {current_version}. Minor version differences are usually safe; major differences may cause unexpected behavior.",
            js_string(version)
        )),
        _ => {}
    }

    let mut missing = Vec::new();
    for field in ["messages", "iterations"] {
        if state.get(field).is_none_or(Value::is_null) {
            missing.push(field);
        }
    }
    if !missing.is_empty() {
        warnings.push(format!(
            "Restored state is missing required fields: {}. These will be initialized to defaults.",
            missing.join(", ")
        ));
    }

    match state.get("messages") {
        Some(Value::Array(messages)) if messages.is_empty() => warnings.push(
            "Restored state has no messages — the conversation history may have been empty at checkpoint time.".into(),
        ),
        Some(Value::Array(_)) => {}
        _ => warnings.push(
            "Restored state messages field is not an array — conversation history may be lost.".into(),
        ),
    }

    match state.get("iterations") {
        Some(value)
            if value.is_number() && value.as_f64().is_some_and(|iterations| iterations >= 0.0) => {}
        value => warnings.push(format!(
            "Restored state has invalid iterations value ({}) — will reset to 0.",
            value.map(js_string).unwrap_or_else(|| "undefined".into())
        )),
    }

    let compatible = matches!(state.get("messages"), Some(Value::Array(_)))
        && is_number(state.get("iterations"));
    (compatible, warnings)
}

fn nullish(state: &Value, field: &str, default: Value) -> Value {
    state
        .get(field)
        .filter(|value| !value.is_null())
        .cloned()
        .unwrap_or(default)
}

fn apply_defaults(state: &Value) -> Value {
    let mut restored = Map::new();
    let defaults = [
        ("messages", json!([])),
        ("currentIntent", json!("unknown")),
        ("intentConfidence", json!(0)),
        ("decomposedTask", Value::Null),
        ("taskPhase", json!("brain")),
        ("pendingToolCalls", json!([])),
        ("toolCallRecords", json!([])),
        ("activeAgent", json!("")),
        ("completionSignal", Value::Null),
        ("routingDecision", Value::Null),
        ("webExplorerComplete", json!(false)),
        ("navisInvoked", json!(false)),
        ("searchInvoked", json!(false)),
        ("codingComplete", json!(false)),
        ("codingSpecialistSelfLoopCount", json!(0)),
        ("missionId", json!("")),
        ("missionTimeline", Value::Null),
        ("missionSteps", json!([])),
        ("agiHints", json!("")),
        ("pauseGeneration", json!(false)),
        ("validationResult", Value::Null),
        ("shouldContinueIteration", json!(false)),
        ("hitlApprovalResult", Value::Null),
        ("currentStepId", json!("")),
        ("webExplorerSelfLoopCount", json!(0)),
        ("dataAnalysisComplete", json!(false)),
        ("dataAnalysisSelfLoopCount", json!(0)),
        ("computerUseComplete", json!(false)),
        ("deepResearchComplete", json!(false)),
        ("deepResearchSelfLoopCount", json!(0)),
        ("subagentSpawned", Value::Null),
        ("completedSteps", json!([])),
        ("decompositionAttempts", json!(0)),
        ("brainToolsInFlight", json!(false)),
        ("returningFromSpecialist", Value::Null),
        ("debateResult", Value::Null),
        ("resumingFromFormResponse", json!(false)),
    ];
    for (field, default) in defaults {
        restored.insert(field.into(), nullish(state, field, default));
    }
    let iterations = state
        .get("iterations")
        .filter(|value| value.is_number() && value.as_f64().is_some_and(|value| value >= 0.0))
        .cloned()
        .unwrap_or_else(|| json!(0));
    restored.insert("iterations".into(), iterations);

    // These three defaults intentionally distinguish an absent field from a saved null.
    for field in ["toolCallHistory", "userConfirmation", "finalResponse"] {
        if let Some(value) = state.get(field) {
            restored.insert(field.into(), value.clone());
        } else if field != "userConfirmation" {
            restored.insert(
                field.into(),
                if field == "toolCallHistory" {
                    json!([])
                } else {
                    json!("")
                },
            );
        }
    }
    Value::Object(restored)
}

/// Mirrors the runner's compatibility report and safe-default restoration.
pub fn restore(request: &Value) -> Value {
    let state = request.get("state").unwrap_or(request);
    let current_version = request["currentVersion"]
        .as_str()
        .unwrap_or(SERIALIZATION_VERSION);
    let (compatible, warnings) = compatibility(state, current_version);
    json!({
        "compatible": compatible,
        "warnings": warnings,
        "restoredState": apply_defaults(state),
    })
}
