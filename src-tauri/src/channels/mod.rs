use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// One upstream channel (a single API Key + base URL combo)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Channel {
    pub id: String,
    pub name: String,
    pub base_url: String, // e.g. https://api.openai.com
    pub api_key: String,
    pub models: Vec<String>, // which models this channel serves
    pub protocol: ChannelProtocol,
    pub weight: u32, // for weighted round-robin
    pub enabled: bool,
    pub healthy: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum ChannelProtocol {
    #[serde(rename = "openai-chat-completions")]
    OpenAIChatCompletions,
    #[serde(rename = "openai-responses")]
    OpenAIResponses,
    #[serde(rename = "anthropic-messages")]
    AnthropicMessages,
    #[serde(rename = "openai-compatible-chat-completions")]
    OpenAICompatibleChatCompletions,
}

/// Channel pool with thread-safe access
pub struct ChannelPool {
    channels: Arc<RwLock<Vec<Channel>>>,
}

impl ChannelPool {
    pub fn new() -> Self {
        Self {
            channels: Arc::new(RwLock::new(Vec::new())),
        }
    }

    pub fn list(&self) -> Vec<Channel> {
        self.channels.read().clone()
    }

    pub fn add(&self, mut channel: Channel) -> String {
        channel.id = Uuid::new_v4().to_string();
        self.channels.write().push(channel.clone());
        channel.id
    }

    pub fn update(&self, id: &str, f: impl FnOnce(&mut Channel)) -> bool {
        let mut chs = self.channels.write();
        if let Some(ch) = chs.iter_mut().find(|c| c.id == id) {
            f(ch);
            true
        } else {
            false
        }
    }

    pub fn delete(&self, id: &str) -> bool {
        let mut chs = self.channels.write();
        let len_before = chs.len();
        chs.retain(|c| c.id != id);
        chs.len() != len_before
    }

    /// Select healthy/enabled channels matching a model.
    ///
    /// The returned order is the routing priority used by the gateway:
    /// higher weights are tried first, then names/ids make the order stable.
    pub fn select_for_model(&self, model: &str) -> Vec<Channel> {
        let mut channels: Vec<Channel> = self
            .channels
            .read()
            .iter()
            .filter(|c| c.enabled && c.healthy && c.models.iter().any(|m| m == model))
            .cloned()
            .collect();

        channels.sort_by(|a, b| {
            b.weight
                .cmp(&a.weight)
                .then_with(|| a.name.cmp(&b.name))
                .then_with(|| a.id.cmp(&b.id))
        });

        channels
    }

    /// Get all available models across all healthy channels
    pub fn all_models(&self) -> Vec<String> {
        let mut models: Vec<String> = self
            .channels
            .read()
            .iter()
            .filter(|c| c.enabled && c.healthy)
            .flat_map(|c| c.models.clone())
            .collect();
        models.sort();
        models.dedup();
        models
    }
}
