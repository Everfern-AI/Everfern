use chrono::{
    DateTime, Datelike, Duration, Local, NaiveDateTime, SecondsFormat, TimeZone, Timelike, Weekday,
};

fn resolve_local(mut wall: NaiveDateTime) -> Option<DateTime<Local>> {
    if let Some(time) = Local.from_local_datetime(&wall).earliest() {
        return Some(time);
    }
    // JavaScript advances nonexistent wall times by the transition gap.
    let before = Local
        .from_local_datetime(&wall.checked_sub_signed(Duration::days(1))?)
        .earliest()?;
    let after = Local
        .from_local_datetime(&wall.checked_add_signed(Duration::days(1))?)
        .earliest()?;
    let gap = after.offset().local_minus_utc() - before.offset().local_minus_utc();
    wall = wall.checked_add_signed(Duration::seconds(i64::from(gap)))?;
    Local.from_local_datetime(&wall).earliest()
}

fn add_wall(time: DateTime<Local>, offset: Duration) -> Option<DateTime<Local>> {
    resolve_local(time.naive_local().checked_add_signed(offset)?)
}

pub fn first_run(cron: &str, starts_at: &str, now: DateTime<Local>) -> Result<String, String> {
    next_run(cron, Some(starts_at), None, now)
}

fn parse_date(date: &str) -> Option<DateTime<Local>> {
    DateTime::parse_from_rfc3339(date)
        .map(|date| date.with_timezone(&Local))
        .ok()
        .or_else(|| {
            ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%dT%H:%M"]
                .iter()
                .find_map(|format| NaiveDateTime::parse_from_str(date, format).ok())
                .and_then(resolve_local)
        })
        .or_else(|| {
            chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d")
                .ok()
                .and_then(|date| date.and_hms_opt(0, 0, 0))
                .map(|date| chrono::Utc.from_utc_datetime(&date).with_timezone(&Local))
        })
}

pub fn pick_due_worker(workers: &[serde_json::Value], now: i64) -> Option<usize> {
    workers
        .iter()
        .enumerate()
        .filter_map(|(index, worker)| {
            if !matches!(
                worker["schedule"]["kind"].as_str(),
                Some("hourly" | "daily" | "weekdays" | "once")
            ) || matches!(worker["status"].as_str(), Some("paused" | "draft"))
                || worker["prompt"].as_str().unwrap_or("").trim().is_empty()
            {
                return None;
            }
            let next = parse_date(worker["schedule"]["nextRun"].as_str()?)?.timestamp_millis();
            (next <= now).then_some((next, index))
        })
        .min()
        .map(|(_, index)| index)
}

pub fn advance_worker_schedule(
    schedule: &serde_json::Value,
    now_ms: i64,
) -> Option<serde_json::Value> {
    use serde_json::json;
    let now = Local.timestamp_millis_opt(now_ms).single()?;
    let due = parse_date(schedule["nextRun"].as_str()?)?;
    let mut updated = schedule.clone();
    let (next, missed) = match schedule["kind"].as_str()? {
        "hourly" => {
            let steps = ((now - due).num_milliseconds().div_euclid(3_600_000) + 1).max(1);
            (due.checked_add_signed(Duration::hours(steps))?, steps - 1)
        }
        kind @ ("daily" | "weekdays") => {
            let (hour, minute) = schedule["hour"]
                .as_u64()
                .zip(schedule["minute"].as_u64())
                .filter(|(hour, minute)| *hour <= 23 && *minute <= 59)
                .map(|(h, m)| (h as u32, m as u32))
                .unwrap_or_else(|| {
                    time_from_worker_label(schedule["label"].as_str().unwrap_or(""))
                });
            updated["hour"] = json!(hour);
            updated["minute"] = json!(minute);
            let next_at = |time: DateTime<Local>| {
                let mut next = resolve_local(time.date_naive().and_hms_opt(hour, minute, 0)?)?;
                if next <= time {
                    next = add_wall(next, Duration::days(1))?;
                }
                while kind == "weekdays" && matches!(next.weekday(), Weekday::Sat | Weekday::Sun) {
                    next = add_wall(next, Duration::days(1))?;
                }
                Some(next)
            };
            let mut occurrence = next_at(due)?;
            let mut missed = 0;
            while occurrence <= now && missed < 1000 {
                missed += 1;
                occurrence = next_at(occurrence)?;
            }
            (next_at(now)?, missed)
        }
        _ => return None,
    };
    updated["nextRun"] = json!(next.to_utc().to_rfc3339_opts(SecondsFormat::Millis, true));
    if missed > 0 {
        updated["missed"] = json!(missed);
    } else {
        updated.as_object_mut()?.remove("missed");
    }
    Some(updated)
}

fn time_from_worker_label(label: &str) -> (u32, u32) {
    let bytes = label.as_bytes();
    for index in 1..bytes.len().saturating_sub(2) {
        if bytes[index] != b':'
            || !bytes[index - 1].is_ascii_digit()
            || !bytes[index + 1..index + 3].iter().all(u8::is_ascii_digit)
        {
            continue;
        }
        let start = if index >= 2 && bytes[index - 2].is_ascii_digit() {
            index - 2
        } else {
            index - 1
        };
        let hour = label[start..index].parse::<u32>().unwrap_or(9);
        let minute = label[index + 1..index + 3].parse::<u32>().unwrap_or(0);
        return (hour.min(23), minute.min(59));
    }
    (9, 0)
}

pub fn task_decisions(tasks: &[serde_json::Value], now: DateTime<Local>) -> serde_json::Value {
    use serde_json::{json, Value};
    Value::Array(
        tasks
            .iter()
            .map(|task| {
                let date = |field: &str| task[field].as_str().and_then(parse_date);
                if task["enabled"] != true {
                    return json!("skip");
                }
                if date("endsAt").is_some_and(|end| now > end) {
                    return json!("expire");
                }
                if date("nextRun").is_some_and(|next| now >= next) {
                    return json!("run");
                }
                let empty = |field: &str| task[field].as_str().unwrap_or("").is_empty();
                if empty("nextRun") && empty("lastRun") {
                    return if date("startsAt").is_some_and(|start| now >= start) {
                        json!("run")
                    } else {
                        json!("initialize")
                    };
                }
                json!("skip")
            })
            .collect(),
    )
}

pub fn next_run(
    cron: &str,
    starts_at: Option<&str>,
    last_run: Option<&str>,
    now: DateTime<Local>,
) -> Result<String, String> {
    let start = starts_at
        .filter(|date| !date.is_empty())
        .map(|date| parse_date(date).ok_or("Invalid start date"))
        .transpose()?;
    let last = last_run
        .map(|date| parse_date(date).ok_or("Invalid last run date"))
        .transpose()?;
    let base = last.or(start).unwrap_or(now);
    let next = calculate(cron, base, start, last.is_some(), now).ok_or("Invalid next run date")?;
    Ok(next.to_utc().to_rfc3339_opts(SecondsFormat::Millis, true))
}

fn calculate(
    cron: &str,
    base: DateTime<Local>,
    start: Option<DateTime<Local>>,
    has_run: bool,
    now: DateTime<Local>,
) -> Option<DateTime<Local>> {
    if cron == "daily" || cron.starts_with("weekly:") {
        let target = cron
            .split(':')
            .nth(1)
            .and_then(|day| day.to_ascii_lowercase().parse::<Weekday>().ok());
        if cron != "daily" && target.is_none() {
            return Some(base);
        }
        let rounded = match start {
            Some(start) => resolve_local(base.date_naive().and_hms_opt(
                start.hour(),
                start.minute(),
                0,
            )?)?,
            None => base,
        };
        let elapsed = rounded <= now || (has_run && rounded <= base);
        let days = match target {
            Some(day) => {
                let offset = i64::from(day.num_days_from_sunday())
                    - i64::from(rounded.weekday().num_days_from_sunday());
                if offset < 0 || (offset == 0 && elapsed) {
                    offset + 7
                } else {
                    offset
                }
            }
            None => i64::from(elapsed),
        };
        if days == 0 && target.is_none() {
            return Some(rounded);
        }
        return add_wall(rounded, Duration::days(days));
    }
    let Some(interval) = cron.strip_prefix("every ") else {
        return add_wall(base, Duration::hours(1));
    };
    let mut parts = interval.split(' ');
    let value = parts.next()?.trim_start();
    let value = value.strip_prefix('+').unwrap_or(value);
    let end = value
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(value.len());
    let count = value[..end].parse::<i64>().unwrap_or(0);
    let Some(unit) = parts.next() else {
        return add_wall(base, Duration::days(1));
    };
    let unit = unit.to_ascii_lowercase();
    let seconds = [
        ("minute", 60_i64),
        ("hour", 3600),
        ("day", 86400),
        ("week", 604800),
    ]
    .into_iter()
    .find(|(prefix, _)| unit.starts_with(prefix))
    .map(|(_, seconds)| seconds);
    let initial = match seconds {
        Some(seconds) => Duration::try_seconds(count.checked_mul(seconds)?)?,
        None => Duration::zero(),
    };
    let step = if initial.is_zero() {
        Duration::days(1)
    } else {
        initial
    };
    let mut next = if seconds.is_none() {
        base
    } else {
        add_wall(base, initial)?
    };
    for _ in 0..=10000 {
        if has_run || next > now {
            break;
        }
        let candidate = add_wall(next, step)?;
        if candidate == next {
            break;
        }
        next = candidate;
    }
    Some(next)
}

#[cfg(test)]
#[test]
fn overdue_worker_claim_keeps_hourly_cadence() {
    use serde_json::json;
    let workers = [
        json!({"status":"paused","prompt":"test","schedule":{"kind":"hourly","nextRun":"2025-01-01T00:00:00Z"}}),
        json!({"status":"idle","prompt":"test","schedule":{"kind":"hourly","nextRun":"2025-01-01T01:00:00Z"}}),
    ];
    let now = parse_date("2025-01-01T03:30:00Z")
        .unwrap()
        .timestamp_millis();
    let index = pick_due_worker(&workers, now).unwrap();
    assert_eq!(index, 1);
    let next = advance_worker_schedule(&workers[index]["schedule"], now).unwrap();
    assert_eq!(next["nextRun"], "2025-01-01T04:00:00.000Z");
    assert_eq!(next["missed"], 2);
}
