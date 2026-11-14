//! Spore Radio Freenet contract: stores live station presence and automatic WebRTC
//! signaling (join -> offer -> answer) for a radio room keyed by its room ID.

use freenet_stdlib::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const MAX_SIGNALS: usize = 16;
pub const MAX_SDP_LEN: usize = 32 * 1024;
pub const MAX_STR_LEN: usize = 256;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct StationInfo {
    pub station_name: String,
    pub genre: String,
    pub dj_name: String,
    pub now_playing: String,
    pub live: bool,
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct SignalEntry {
    pub listener_id: String,
    pub joined_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct RadioRoomState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub station: Option<StationInfo>,
    #[serde(default)]
    pub signals: BTreeMap<String, SignalEntry>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct RadioSummary {
    pub station_ts: u64,
    pub signals: BTreeMap<String, (u8, u64)>,
}

fn err(m: &str) -> ContractError {
    ContractError::Other(m.into())
}

fn progress_rank(e: &SignalEntry) -> u8 {
    if e.answer.is_some() {
        2
    } else if e.offer.is_some() {
        1
    } else {
        0
    }
}

fn signal_key(e: &SignalEntry) -> (u8, u64, u64, &Option<String>, &Option<String>) {
    (progress_rank(e), e.ts, e.joined_at, &e.offer, &e.answer)
}

fn station_key(s: &StationInfo) -> (u64, u8, &str, &str, &str, &str) {
    (
        s.ts,
        u8::from(s.live),
        &s.now_playing,
        &s.station_name,
        &s.genre,
        &s.dj_name,
    )
}

fn check_station(s: &StationInfo) -> Result<(), ContractError> {
    if s.station_name.len() > MAX_STR_LEN
        || s.genre.len() > MAX_STR_LEN
        || s.dj_name.len() > MAX_STR_LEN
        || s.now_playing.len() > MAX_STR_LEN
    {
        return Err(err("station metadata too long"));
    }
    Ok(())
}

fn check_signal(k: &str, e: &SignalEntry) -> Result<(), ContractError> {
    if k.is_empty() || k != e.listener_id || k.len() > 128 {
        return Err(err("invalid listener_id"));
    }
    if e.offer.as_ref().is_some_and(|o| o.len() > MAX_SDP_LEN)
        || e.answer.as_ref().is_some_and(|a| a.len() > MAX_SDP_LEN)
    {
        return Err(err("sdp too large"));
    }
    Ok(())
}

pub fn merge(state: &mut RadioRoomState, inc: RadioRoomState) -> Result<(), ContractError> {
    if let Some(inc_station) = inc.station {
        check_station(&inc_station)?;
        let replace = state
            .station
            .as_ref()
            .map_or(true, |cur| station_key(&inc_station) > station_key(cur));
        if replace {
            state.station = Some(inc_station);
        }
    }

    for (k, inc_sig) in inc.signals {
        check_signal(&k, &inc_sig)?;
        let replace = state
            .signals
            .get(&k)
            .map_or(true, |cur| signal_key(&inc_sig) > signal_key(cur));
        if replace {
            state.signals.insert(k, inc_sig);
        }
    }

    if state.signals.len() > MAX_SIGNALS {
        let mut keys_by_age: Vec<(u64, String)> = state
            .signals
            .iter()
            .map(|(k, v)| (v.joined_at, k.clone()))
            .collect();
        keys_by_age.sort_by(|a, b| b.cmp(a));
        keys_by_age.truncate(MAX_SIGNALS);
        let keep: std::collections::BTreeSet<String> =
            keys_by_age.into_iter().map(|(_, k)| k).collect();
        state.signals.retain(|k, _| keep.contains(k));
    }

    Ok(())
}

pub fn summarize(s: &RadioRoomState) -> RadioSummary {
    RadioSummary {
        station_ts: s.station.as_ref().map_or(0, |st| st.ts),
        signals: s
            .signals
            .iter()
            .map(|(k, v)| (k.clone(), (progress_rank(v), v.ts)))
            .collect(),
    }
}

pub fn delta(s: &RadioRoomState, peer: &RadioSummary) -> RadioRoomState {
    let station = s
        .station
        .as_ref()
        .filter(|st| st.ts > peer.station_ts)
        .cloned();
    let signals = s
        .signals
        .iter()
        .filter(|(k, v)| {
            peer.signals
                .get(*k)
                .map_or(true, |&(rank, ts)| (progress_rank(v), v.ts) > (rank, ts))
        })
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    RadioRoomState { station, signals }
}

fn de<T: for<'a> Deserialize<'a> + Default>(b: &[u8]) -> Result<T, ContractError> {
    if b.is_empty() {
        return Ok(T::default());
    }
    serde_json::from_slice(b).map_err(|e| ContractError::Deser(e.to_string()))
}

fn ser<T: Serialize>(v: &T) -> Result<Vec<u8>, ContractError> {
    serde_json::to_vec(v).map_err(|e| ContractError::Deser(e.to_string()))
}

pub struct SporeRadioContract;

#[contract]
impl ContractInterface for SporeRadioContract {
    fn validate_state(
        _p: Parameters<'static>,
        state: State<'static>,
        _r: RelatedContracts<'static>,
    ) -> Result<ValidateResult, ContractError> {
        let ok = de::<RadioRoomState>(state.as_ref()).is_ok_and(|s| {
            s.signals.len() <= MAX_SIGNALS
                && s.station.as_ref().map_or(true, |st| check_station(st).is_ok())
                && s.signals.iter().all(|(k, v)| check_signal(k, v).is_ok())
        });
        Ok(if ok {
            ValidateResult::Valid
        } else {
            ValidateResult::Invalid
        })
    }

    fn update_state(
        _p: Parameters<'static>,
        state: State<'static>,
        data: Vec<UpdateData<'static>>,
    ) -> Result<UpdateModification<'static>, ContractError> {
        let mut cur: RadioRoomState = de(state.as_ref())?;
        for item in data {
            let parts: Vec<Vec<u8>> = match item {
                UpdateData::State(s) => vec![s.as_ref().to_vec()],
                UpdateData::Delta(d) => vec![d.as_ref().to_vec()],
                UpdateData::StateAndDelta { state, delta } => {
                    vec![state.as_ref().to_vec(), delta.as_ref().to_vec()]
                }
                _ => return Err(ContractError::InvalidUpdate),
            };
            for part in parts {
                merge(&mut cur, de(&part)?)?;
            }
        }
        Ok(UpdateModification::valid(State::from(ser(&cur)?)))
    }

    fn summarize_state(
        _p: Parameters<'static>,
        state: State<'static>,
    ) -> Result<StateSummary<'static>, ContractError> {
        Ok(StateSummary::from(ser(&summarize(&de(state.as_ref())?))?))
    }

    fn get_state_delta(
        _p: Parameters<'static>,
        state: State<'static>,
        summary: StateSummary<'static>,
    ) -> Result<StateDelta<'static>, ContractError> {
        let d = delta(&de(state.as_ref())?, &de(summary.as_ref())?);
        if d.station.is_none() && d.signals.is_empty() {
            Ok(StateDelta::from(vec![]))
        } else {
            Ok(StateDelta::from(ser(&d)?))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sig(id: &str, joined: u64, offer: Option<&str>, answer: Option<&str>, ts: u64) -> (String, SignalEntry) {
        (
            id.to_string(),
            SignalEntry {
                listener_id: id.to_string(),
                joined_at: joined,
                offer: offer.map(str::to_string),
                answer: answer.map(str::to_string),
                ts,
            },
        )
    }

    #[test]
    fn signaling_progression_and_merge_laws() {
        let join = RadioRoomState {
            station: Some(StationInfo {
                station_name: "Spore FM".into(),
                genre: "IDM".into(),
                dj_name: "scobru".into(),
                now_playing: "Track 1".into(),
                live: true,
                ts: 10,
            }),
            signals: [sig("l1", 100, None, None, 100)].into_iter().collect(),
        };
        let offer = RadioRoomState {
            station: None,
            signals: [sig("l1", 100, Some("sdp-offer"), None, 101)].into_iter().collect(),
        };
        let answer = RadioRoomState {
            station: None,
            signals: [sig("l1", 100, Some("sdp-offer"), Some("sdp-answer"), 102)].into_iter().collect(),
        };

        let mut a = RadioRoomState::default();
        merge(&mut a, join.clone()).unwrap();
        merge(&mut a, offer.clone()).unwrap();
        merge(&mut a, answer.clone()).unwrap();

        let mut b = RadioRoomState::default();
        merge(&mut b, answer).unwrap();
        merge(&mut b, join).unwrap();
        merge(&mut b, offer).unwrap();

        assert_eq!(a, b);
        assert_eq!(a.signals["l1"].answer.as_deref(), Some("sdp-answer"));
    }
}
