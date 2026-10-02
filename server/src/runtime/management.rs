use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub status: String,
    pub cpu_percent: Option<f32>,
    pub memory_bytes: Option<u64>,
    pub disk_bytes: Option<u64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInstance {
    pub id: String,
    pub space_id: String,
    pub username: Option<String>,
    #[serde(flatten)]
    pub snapshot: RuntimeSnapshot,
}
