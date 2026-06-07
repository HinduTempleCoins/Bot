// stages-data.mjs — BUILD-TIME EMBED of the tutorial stage catalog.
// Generated from tutorial/stages.json via signup/server.mjs stageCatalog() (trimmed,
// public-safe shape — same fields the /api/stages endpoint serves). Regenerate with:
//   node -e 'import("./signup/server.mjs").then(m=>console.log(JSON.stringify(m.stageCatalog(),null,2)))'
// Embedding avoids needing the tutorial API exposed on the alpha vhost.

export const STAGE_DATA = {
  "currency": "MELEK",
  "tier_legend": {
    "A": "Works now — standard Graphene only. Detector + composer can run today.",
    "B": "Placeholder — depends on infra not yet built (SMTs/Trading/Curation/Video/Wiki/Bridge). Stage is reachable and validated, but `infra_gated: true` keeps the detector from arming it until the feature exists.",
    "C": "AI-on-the-Chain closer — the conversational/relationship arc that opens in Phase 3."
  },
  "stages": [
    {
      "id": 1,
      "key": "intro_post",
      "tier": "A",
      "label": "Post an introduction",
      "description": "New user publishes a top-level post introducing themselves.",
      "infra_gated": false,
      "next_stage": 2
    },
    {
      "id": 2,
      "key": "engage_three_posts",
      "tier": "A",
      "label": "Comment meaningfully on three other users' posts",
      "description": "User leaves substantive comments (not one-word reactions) on three distinct other authors' posts.",
      "infra_gated": false,
      "next_stage": 3
    },
    {
      "id": 3,
      "key": "share_what_you_know",
      "tier": "A",
      "label": "Write a how-to or share something you know",
      "description": "User publishes a substantive post sharing knowledge or a how-to.",
      "infra_gated": false,
      "next_stage": 4
    },
    {
      "id": 4,
      "key": "first_organic_upvote",
      "tier": "A",
      "label": "Receive your first upvote from another user",
      "description": "Any post or comment by the user receives an upvote from an account other than Hathor.",
      "infra_gated": false,
      "next_stage": 5
    },
    {
      "id": 5,
      "key": "power_up",
      "tier": "A",
      "label": "Power up some MELEK to MP",
      "description": "User powers up at least 1.000 liquid MELEK to MELEK Power.",
      "infra_gated": false,
      "next_stage": 6
    },
    {
      "id": 6,
      "key": "vote_for_a_witness",
      "tier": "A",
      "label": "Vote for a witness",
      "description": "User casts at least one witness vote.",
      "infra_gated": false,
      "next_stage": 7
    },
    {
      "id": 7,
      "key": "set_profile",
      "tier": "A",
      "label": "Fill in your profile",
      "description": "User sets a profile (display name, about, and optionally an avatar) via account JSON metadata.",
      "infra_gated": false,
      "next_stage": 8
    },
    {
      "id": 8,
      "key": "follow_three_authors",
      "tier": "A",
      "label": "Follow three authors",
      "description": "User follows at least three distinct accounts so their feed becomes their own.",
      "infra_gated": false,
      "next_stage": 9
    },
    {
      "id": 9,
      "key": "send_first_transfer",
      "tier": "A",
      "label": "Send your first transfer",
      "description": "User sends a liquid MELEK transfer to another account, learning the transfer-with-memo primitive.",
      "infra_gated": false,
      "next_stage": 10
    },
    {
      "id": 10,
      "key": "delegate_some_mp",
      "tier": "A",
      "label": "Delegate some MELEK Power",
      "description": "User delegates a portion of their MP to another account, learning that MP can be lent without being spent.",
      "infra_gated": false,
      "next_stage": 11
    },
    {
      "id": 11,
      "key": "join_a_community",
      "tier": "B",
      "label": "Join or post in a community",
      "description": "User posts into a community / sub-tag space once communities exist on MELEK.",
      "infra_gated": true,
      "next_stage": 12
    },
    {
      "id": 12,
      "key": "curate_with_intent",
      "tier": "B",
      "label": "Curate — vote early and thoughtfully",
      "description": "User earns curation rewards by upvoting good work early, once the curation-rewards economics are enabled.",
      "infra_gated": true,
      "next_stage": 13
    },
    {
      "id": 13,
      "key": "create_a_token",
      "tier": "B",
      "label": "Create or hold an SMT-style token",
      "description": "User mints or first holds a Smart-Media-Token-style asset once SMTs exist on MELEK.",
      "infra_gated": true,
      "next_stage": 14
    },
    {
      "id": 14,
      "key": "first_market_trade",
      "tier": "B",
      "label": "Make your first market trade",
      "description": "User places a trade on the internal market once trading infra is live.",
      "infra_gated": true,
      "next_stage": 15
    },
    {
      "id": 15,
      "key": "publish_a_video",
      "tier": "B",
      "label": "Publish a video post",
      "description": "User publishes a video-bearing post once video hosting/embedding infra exists.",
      "infra_gated": true,
      "next_stage": 16
    },
    {
      "id": 16,
      "key": "contribute_to_the_wiki",
      "tier": "B",
      "label": "Contribute to the wiki",
      "description": "User edits or creates an article in the MELEK wiki once the wiki is live.",
      "infra_gated": true,
      "next_stage": 17
    },
    {
      "id": 17,
      "key": "use_the_bridge",
      "tier": "B",
      "label": "Bridge an asset in or out",
      "description": "User moves an asset across the bridge once the (audited) bridge is live.",
      "infra_gated": true,
      "next_stage": 18
    },
    {
      "id": 18,
      "key": "meet_the_witness",
      "tier": "C",
      "label": "Have a real conversation with Hathor",
      "description": "User opens a genuine, multi-turn conversation with the Witness — the AI-on-the-chain arc begins.",
      "infra_gated": false,
      "next_stage": 19
    },
    {
      "id": 19,
      "key": "become_a_node_of_the_network",
      "tier": "C",
      "label": "Welcome the next newcomer yourself",
      "description": "User, now established, welcomes a newer user — becoming a node of the Network of Angels rather than only a recipient of it. The arc closes by handing the work onward.",
      "infra_gated": false,
      "next_stage": null
    }
  ]
};
