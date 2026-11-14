//! Spore P2P Freenet contract: stores peer presence, per-peer music catalogs,
//! and automatic WebRTC DataChannel signaling for P2P file transfers.

use freenet_stdlib::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const MAX_PEERS: usize = 64;
pub const MAX_SIGNALS: usize = 32;
pub const MAX_TRACKS: usize = 2000;
pub const MAX_SDP_LEN: usize = 32 * 1024;
pub const MAX_STR_LEN: usize = 256;

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct PeerInfo {
    pub peer_id: String,
    pub username: String,
    pub track_count: u32,
    pub total_bytes: u64,
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct CatalogTrack {
    pub filename: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub genre: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub year: Option<u32>,
    pub duration_secs: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bitrate_kbps: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    pub format: String,
    pub size_bytes: u64,
    pub blake3_hash: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct PeerCatalog {
    pub peer_id: String,
    pub username: String,
    pub ts: u64,
    #[serde(default)]
    pub tracks: Vec<CatalogTrack>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct P2pSignal {
    pub signal_id: String,
    pub from_peer: String,
    pub to_peer: String,
    pub created_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub offer: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer: Option<String>,
    pub ts: u64,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct SporeP2pState {
    #[serde(default)]
    pub peers: BTreeMap<String, PeerInfo>,
    #[serde(default)]
    pub signals: BTreeMap<String, P2pSignal>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub catalog: Option<PeerCatalog>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq)]
pub struct SporeP2pSummary {
    pub peers: BTreeMap<String, u64>,
    pub signals: BTreeMap<String, (u8, u64)>,
    pub catalog_ts: u64,
}

fn err(m: &str) -> ContractError {
    ContractError::Other(m.into())
}

fn progress_rank(e: &P2pSignal) -> u8 {
    if e.answer.is_some() {
        2
    } else if e.offer.is_some() {
        1
    } else {
        0
    }
}

fn signal_key(e: &P2pSignal) -> (u8, u64, u64, &Option<String>, &Option<String>) {
    (progress_rank(e), e.ts, e.created_at, &e.offer, &e.answer)
}

fn peer_key(p: &PeerInfo) -> (u64, u32, u64, &str) {
    (p.ts, p.track_count, p.total_bytes, &p.username)
}

fn check_peer(k: &str, p: &PeerInfo) -> Result<(), ContractError> {
    if k.is_empty() || k != p.peer_id || k.len() > 128 || p.username.len() > MAX_STR_LEN {
        return Err(err("invalid peer"));
    }
    Ok(())
}

fn check_signal(k: &str, s: &P2pSignal) -> Result<(), ContractError> {
    if k.is_empty()
        || k != s.signal_id
        || k.len() > 192
        || s.from_peer.is_empty()
        || s.to_peer.is_empty()
        || s.from_peer.len() > 128
        || s.to_peer.len() > 128
    {
        return Err(err("invalid signal"));
    }
    if s.offer.as_ref().is_some_and(|o| o.len() > MAX_SDP_LEN)
        || s.answer.as_ref().is_some_and(|a| a.len() > MAX_SDP_LEN)
    {
        return Err(err("sdp too large"));
    }
    Ok(())
}

fn check_catalog(c: &PeerCatalog) -> Result<(), ContractError> {
    if c.peer_id.is_empty() || c.peer_id.len() > 128 || c.username.len() > MAX_STR_LEN {
        return Err(err("invalid catalog owner"));
    }
    if c.tracks.len() > MAX_TRACKS {
        return Err(err("too many tracks in catalog"));
    }
    Ok(())
}

pub fn merge(state: &mut SporeP2pState, inc: SporeP2pState) -> Result<(), ContractError> {
    for (k, inc_peer) in inc.peers {
        check_peer(&k, &inc_peer)?;
        let replace = state
            .peers
            .get(&k)
            .map_or(true, |cur| peer_key(&inc_peer) > peer_key(cur));
        if replace {
            state.peers.insert(k, inc_peer);
        }
    }

    if state.peers.len() > MAX_PEERS {
        let mut by_ts: Vec<(u64, String)> =
            state.peers.iter().map(|(k, v)| (v.ts, k.clone())).collect();
        by_ts.sort_by(|a, b| b.cmp(a));
        by_ts.truncate(MAX_PEERS);
        let keep: BTreeSet<String> = by_ts.into_iter().map(|(_, k)| k).collect();
        state.peers.retain(|k, _| keep.contains(k));
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
        let mut by_age: Vec<(u64, String)> = state
            .signals
            .iter()
            .map(|(k, v)| (v.created_at, k.clone()))
            .collect();
        by_age.sort_by(|a, b| b.cmp(a));
        by_age.truncate(MAX_SIGNALS);
        let keep: BTreeSet<String> = by_age.into_iter().map(|(_, k)| k).collect();
        state.signals.retain(|k, _| keep.contains(k));
    }

    if let Some(inc_cat) = inc.catalog {
        check_catalog(&inc_cat)?;
        let replace = state.catalog.as_ref().map_or(true, |cur| {
            (inc_cat.ts, inc_cat.tracks.len()) > (cur.ts, cur.tracks.len())
        });
        if replace {
            state.catalog = Some(inc_cat);
        }
    }

    Ok(())
}

pub fn summarize(s: &SporeP2pState) -> SporeP2pSummary {
    SporeP2pSummary {
        peers: s.peers.iter().map(|(k, v)| (k.clone(), v.ts)).collect(),
        signals: s
            .signals
            .iter()
            .map(|(k, v)| (k.clone(), (progress_rank(v), v.ts)))
            .collect(),
        catalog_ts: s.catalog.as_ref().map_or(0, |c| c.ts),
    }
}

pub fn delta(s: &SporeP2pState, peer: &SporeP2pSummary) -> SporeP2pState {
    let peers = s
        .peers
        .iter()
        .filter(|(k, v)| peer.peers.get(*k).map_or(true, |&ts| v.ts > ts))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();

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

    let catalog = s
        .catalog
        .as_ref()
        .filter(|c| c.ts > peer.catalog_ts)
        .cloned();

    SporeP2pState {
        peers,
        signals,
        catalog,
    }
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

pub struct SporeP2pContract;

#[contract]
impl ContractInterface for SporeP2pContract {
    fn validate_state(
        _p: Parameters<'static>,
        state: State<'static>,
        _r: RelatedContracts<'static>,
    ) -> Result<ValidateResult, ContractError> {
        let ok = de::<SporeP2pState>(state.as_ref()).is_ok_and(|s| {
            s.peers.len() <= MAX_PEERS
                && s.signals.len() <= MAX_SIGNALS
                && s.peers.iter().all(|(k, v)| check_peer(k, v).is_ok())
                && s.signals.iter().all(|(k, v)| check_signal(k, v).is_ok())
                && s.catalog.as_ref().map_or(true, |c| check_catalog(c).is_ok())
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
        let mut cur: SporeP2pState = de(state.as_ref())?;
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
        if d.peers.is_empty() && d.signals.is_empty() && d.catalog.is_none() {
            Ok(StateDelta::from(vec![]))
        } else {
            Ok(StateDelta::from(ser(&d)?))
        }
    }
}
