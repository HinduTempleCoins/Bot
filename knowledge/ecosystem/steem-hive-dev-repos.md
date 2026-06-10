# Steem / Hive Dev Ecosystem — Who's-Who Reference Repos

_79 foundational Steem/Hive/Graphene developer repositories, cloned for reference._

**Source code:** cloned on melek-5 at `~/steem-hive-repos/<slug>` (797 MB, not committed — too large for this repo). This file + `steem-hive-dev-repos.json` are the discoverable index the AIs and brief writers read.

**Why these matter to MELEK:** our chain is a Steem HF23 fork. These are the canonical implementations we mirror or adapt — the engine/SMT contracts (our `engine/`), the signer pattern (MELEK-Signer reference), the condenser (alpha front-end), the witness tooling (our `witness/`), and the client libraries (we use dhive; beem fixed our witness_update serialization bug).

## Engine / SMT / Tokens (18)

- **[hive-engine/nitrous](https://github.com/hive-engine/nitrous)** — jsx, 640 files. Nitrous is the customized condenser (see below) that integrates with the
- **[CryptoGnome/TerraCore-Smart-Contract](https://github.com/CryptoGnome/TerraCore-Smart-Contract)** — js, 306 files. Blockchain game backend running on Hive and Hive Engine. Handles battles, quests, claims, NFTs, and leaderboard rewards in a single unified process.
- **[hive-engine/hivesmartcontracts](https://github.com/hive-engine/hivesmartcontracts)** — js, 171 files. ## 1.  What is it?
- **[TheCrazyGM/hivesmartcontracts](https://github.com/TheCrazyGM/hivesmartcontracts)** — js, 170 files. ## 1.  What is it?
- **[srbde/nectarengine](https://github.com/srbde/nectarengine)** — py, 119 files. **The modern Python library for Hive Engine tokens. Built for production. Made to last.**
- **[hive-engine/steemsmartcontracts](https://github.com/hive-engine/steemsmartcontracts)** — js, 90 files. **NOTE**: master branch is for Steem Engine, for which further development has been discontinued. Only Hive Engine is currently under active development; This is now at its own repo: https://github.com/hive-engine/hivesmartcontracts.
- **[hive-engine/distribution-engine-smt](https://github.com/hive-engine/distribution-engine-smt)** — py, 65 files. Indexing for Hive Engine Comments Smart Contract
- **[holgern/steemengine](https://github.com/holgern/steemengine)** — py, 63 files. Python tools for obtaining and processing steem engine tokens
- **[hive-engine/hivesmartcontracts-wiki](https://github.com/hive-engine/hivesmartcontracts-wiki)** — ?, 60 files. **Getting started with Engine smart contract development**: first, read all the links below in the **General System Design & Usage** section. After that, read the [Smart Contract Developer's Guide](https://github.com/hive-engine/hivesmartco
- **[hive-engine/steemsmartcontracts-wiki](https://github.com/hive-engine/steemsmartcontracts-wiki)** — ?, 60 files. **Getting started with Engine smart contract development**: first, read all the links below in the **General System Design & Usage** section. Steem is mentioned in some areas, but everything is equally applicable to Hive Engine. After that,
- **[hive-engine/sscjs](https://github.com/hive-engine/sscjs)** — js, 45 files. Light javascript library to interact with the JSON RPC server of [a Steem/Hive Smart Contracts node](https://github.com/hive-engine/steemsmartcontracts)
- **[hive-engine/distribubot](https://github.com/hive-engine/distribubot)** — py, 42 files. Scans blocks for new comments containing the given comment_command. The the comment author has suffient
- **[hive-engine/ssc/tokens/history](https://github.com/hive-engine/ssc_tokens_history)** — js, 42 files. Scans the Steem Smart Contracts blockchain (`history_builder.js`) to generate an index of historical
- **[hive-engine/steempeggedbot](https://github.com/hive-engine/steempeggedbot)** — js, 39 files. _(no description)_
- **[ali-h/airdrop-tool](https://github.com/ali-h/airdrop-tool)** — js, 37 files. An Airdrop tool for Hive-Engine tokens.
- **[hive-engine/network-monitor](https://github.com/hive-engine/network-monitor)** — js, 36 files. This utility monitors the health of the Engine sidechain. It can:
- **[TheCrazyGM/liquiditybot](https://github.com/TheCrazyGM/liquiditybot)** — py, 35 files. A Python-based bot for managing liquidity and performing automated trades for token pairs on the Hive Engine platform. It utilizes `hive-nectar` and `nectarengine` libraries.
- **[hive-engine/scotbot-docs](https://github.com/hive-engine/scotbot-docs)** — ?, 32 files. scotbot documentation

## Signer / Keys / Auth (9)

- **[hive-keychain/hive-keychain-extension](https://github.com/hive-keychain/hive-keychain-extension)** — ts, 1258 files. Secure Hive Wallet Extension.
- **[ecency/hivesigner-ui](https://github.com/ecency/hivesigner-ui)** — vue, 329 files. Optional env variable:
- **[openhive-network/beekeeper](https://github.com/openhive-network/beekeeper)** — ts, 154 files. Standalone wallet daemon with HTTP/WebSocket API for the Hive blockchain.
- **[ledgerconnect/hivesigner](https://github.com/ledgerconnect/hivesigner)** — vue, 151 files. This is UI component of the Hivesigner. There are [SDK](https://github.com/ledgerconnect/hivesigner.js) and [API](https://github.com/ledgerconnect/hivesigner-api) components, check [Wiki](https://github.com/ledgerconnect/hivesigner/wiki) to
- **[ecency/hivesigner-sdk](https://github.com/ecency/hivesigner-sdk)** — ts, 98 files. The official HiveSigner JavaScript SDK, written in Typescript. Library supports both callback and promise functions. Learn more about integration: https://docs.hivesigner.com.
- **[brianoflondon/has-python](https://github.com/brianoflondon/has-python)** — py, 52 files. A very basic demo to show Hive Authentication Service (HAS) in Python
- **[ecency/hivesigner-api](https://github.com/ecency/hivesigner-api)** — js, 49 files. Hivesigner API module handles access token creation/verification, signing, broadcasting transactions, oauth2 for dapps.
- **[hive-keychain/keychain-sdk](https://github.com/hive-keychain/keychain-sdk)** — ts, 46 files. This class is a way to handle Hive Keychain requests, with Typescript support. The purpose is to allow developers to integrate Keychain in a seemless manner.
- **[TheCrazyGM/hive-key-updater](https://github.com/TheCrazyGM/hive-key-updater)** — js, 37 files. A web-based tool for updating Hive blockchain account keys securely. This application is the web equivalent of the Python script `update_password.py`, providing a user-friendly interface for generating and updating Hive account keys with en

## Front-end / Condenser (5)

- **[openhive-network/denser](https://github.com/openhive-network/denser)** — ts, 2014 files. **Decentralized social media app for Hive Blockchain ⛓️**
- **[ecency/ecency-vision](https://github.com/ecency/ecency-vision)** — tsx, 1655 files. UNMAINTAINED! PLEASE CHECK [V4 HERE](https://github.com/ecency/vision-next)
- **[steemit/condenser](https://github.com/steemit/condenser)** — js, 1029 files. Condenser is the react.js web interface to the world's first and best
- **[openhive-network/condenser](https://github.com/openhive-network/condenser)** — jsx, 634 files. Condenser is the react.js web interface to the
- **[openhive-network/hive-renderer](https://github.com/openhive-network/hive-renderer)** — ts, 73 files. 👉 **[Online demo](https://hive.pages.syncad.com/hive-renderer/)**

## Hivemind / HAF / Indexers (5)

- **[openhive-network/hivemind](https://github.com/openhive-network/hivemind)** — py, 4469 files. **Developer-friendly microservice powering social networks on the Hive blockchain**
- **[openhive-network/haf](https://github.com/openhive-network/haf)** — py, 1004 files. The Hive Application Framework was developed to simplify the creation of highly scalable, blockchain-based applications. HAF-based apps are naturally resilient against blockchain forks because HAF contains a mechanism for automatically undo
- **[openhive-network/haf/api/node](https://github.com/openhive-network/haf_api_node)** — js, 265 files. We assume the base system will be running at least Ubuntu 22.04 (jammy).  Everything will likely work with later versions of Ubuntu. IMPORTANT UPDATE: experiments have shown 20% better API performance when running U23.10, so this latter ver
- **[steemit/hivemind](https://github.com/steemit/hivemind)** — py, 155 files. Hive is a  consensus interpretation  layer for the Steem blockchain, maintaining the state of social features such as post feeds, follows, and communities. Written in Python, it synchronizes an SQL database with chain state, providing devel
- **[openhive-network/tinman](https://github.com/openhive-network/tinman)** — py, 74 files. The `tinman` set of utilities is a set of scripts to create a testnet.

## Client Libraries (JS/TS/Python) (15)

- **[srbde/hive-nectar](https://github.com/srbde/hive-nectar)** — py, 327 files. **The modern Python library for the Hive blockchain. Built for production. Made to last.**
- **[holgern/beem](https://github.com/holgern/beem)** — py, 325 files. beem - Unofficial Python Library for HIVE and STEEM
- **[srbde/hive-pollen](https://github.com/srbde/hive-pollen)** — ts, 316 files. **The modern, secure, and zero-dependency TypeScript SDK for the Hive blockchain. Built for production. Made to last.**
- **[xeroc/python-graphenelib](https://github.com/xeroc/python-graphenelib)** — py, 299 files. Visit the [pygraphenelib website](http://docs.pygraphenelib.com/en/latest/) for in depth documentation on this Python library.
- **[openhive-network/dhive](https://github.com/openhive-network/dhive)** — ts, 245 files. Robust hive client library that runs in both node.js and the browser.
- **[DoctorLai/dsteem](https://github.com/DoctorLai/dsteem)** — ts, 208 files. Robust [steem blockchain](https://steem.io) client library that runs in both node.js and the browser.
- **[DoctorLai/steem-js](https://github.com/DoctorLai/steem-js)** — js, 131 files. Steem.js the JavaScript API for Steem blockchain
- **[openhive-network/hive-js](https://github.com/openhive-network/hive-js)** — js, 129 files. Hive.js the Official JavaScript API for Hive blockchain
- **[xeroc/piston-lib](https://github.com/xeroc/piston-lib)** — py, 113 files. This library is unmaintained, do not build productive buisness with it!
- **[xeroc/graphenejs-lib](https://github.com/xeroc/graphenejs-lib)** — js, 89 files. Pure JavaScript Bitshares/Graphene library for node.js and browsers. Can be used to construct, sign and broadcast transactions in JavaScript, and to easily obtain data from the blockchain via public apis.
- **[mahdiyari/hive-tx](https://github.com/mahdiyari/hive-tx)** — ts, 79 files. The most lightweight library for Hive blockchain while being a complete library. Regularly maintained to support the latest features of the blockchain. For Web and NodeJS.
- **[brianoflondon/lighthive](https://github.com/brianoflondon/lighthive)** — py, 58 files. A light python client to interact with the HIVE blockchain. It's simple and stupid. You ask something, you get something.
- **[emre/lighthive](https://github.com/emre/lighthive)** — py, 58 files. A light python client to interact with the HIVE blockchain. It's simple and stupid. You ask something, you get something.
- **[srbde/hoverfly](https://github.com/srbde/hoverfly)** — go, 58 files. **The modern, secure, and ultra-lightweight local Hive mock server. Built for production, made to last.**
- **[TheCrazyGM/nectarflower-js](https://github.com/TheCrazyGM/nectarflower-js)** — js, 39 files. JavaScript utilities for working with the `nectarflower` account's `json_metadata` on the Hive blockchain — primarily for keeping a [dhive](https://github.com/hiveio/dhive) client up to date with a curated list of Hive nodes.

## Witness Infrastructure (feed/monitor/RPC) (11)

- **[Someguy123/hive-witness-essentials](https://github.com/Someguy123/hive-witness-essentials)** — ts, 97 files. Includes Watcher, Pricefeed, Remote, CLI inside `essentials`
- **[DoctorLai/steem-load-balancer](https://github.com/DoctorLai/steem-load-balancer)** — js, 75 files. Here is the [AI-generated documentation](https://deepwiki.com/DoctorLai/steem-load-balancer/) by Deep-Wiki.
- **[Someguy123/hivefeed-js](https://github.com/Someguy123/hivefeed-js)** — js, 61 files. Hive Feed JS
- **[xeroc/witness-monitor](https://github.com/xeroc/witness-monitor)** — py, 48 files. _(no description)_
- **[openhive-network/drone](https://github.com/openhive-network/drone)** — rs, 45 files. Drone is an API caching layer application for the Hive blockchain. It is built using Rust with Actix Web, and its primary purpose is to cache and serve API requests for a specific set of methods.
- **[mahdiyari/witness-notify](https://github.com/mahdiyari/witness-notify)** — ts, 40 files. Sends notifications for missed blocks to [#witness-blocks](https://openhive.chat/channel/witness-blocks) channel on openhive.chat
- **[DoctorLai/pricefeed](https://github.com/DoctorLai/pricefeed)** — js, 39 files. If you already have nodejs & npm installed you can skip this section, but I wanted to include it here for thoroughness. Run the following commands to install nodejs and npm in order to run the pricefeed software:
- **[DoctorLai/SteemWitnessAutoSwitch](https://github.com/DoctorLai/SteemWitnessAutoSwitch)** — js, 38 files. Auto Switch Steem Witness Node
- **[emre/hived-rpc-scanner](https://github.com/emre/hived-rpc-scanner)** — py, 38 files. A CLI tool to check the status of Hive RPC nodes by testing certain endpoints.
- **[ericet/BlurtWitnessAutoSwitch](https://github.com/ericet/BlurtWitnessAutoSwitch)** — js, 37 files. Auto Switch Blurt Witness Node
- **[DoctorLai/monitorwitness](https://github.com/DoctorLai/monitorwitness)** — ?, 32 files. I know, not a very exciting name, I was lazy at the time and it wasn't something I planned on posting anywhere.  I recently threw it up on Github and letting other witnesses benefit from it.

## Account Creation (1)

- **[openhive-network/hive-account-creator](https://github.com/openhive-network/hive-account-creator)** — js, 51 files. This service provides a method to create new Hive accounts, allowing new users to self-register anonymously and without needing to pay a fee. _The network fee is covered by the API operator via configured creator account(s)._

## Bots / Automation (7)

- **[wox-tools/STEEM-AUTO](https://github.com/wox-tools/STEEM-AUTO)** — js, 4010 files. This is a Public Repository of steem Auto Application
- **[openhive-network/workerbee](https://github.com/openhive-network/workerbee)** — ts, 212 files. **A powerful and flexible Hive automation library.**
- **[Steem-FOSSbot/steem-fossbot-voter](https://github.com/Steem-FOSSbot/steem-fossbot-voter)** — js, 140 files. <img src= /img/voter-banner-150.png  alt= Voter logo  style= width: 150px; height: 150px />
- **[Podcastindex-org/podping-hivewriter](https://github.com/Podcastindex-org/podping-hivewriter)** — py, 99 files. The Hive writer component of Podping. You will need a Hive account, see section [Hive account and Authorization](#hive-account) below.
- **[ali-h/hive-bot](https://github.com/ali-h/hive-bot)** — js, 43 files. HiveBot provides real-time automation on top of [Hive Blockchain](https://hive.io/) with a very simple API. You can use it to quickly bootstrap an automated task with Hive without having much understanding about the node's mechanism and tri
- **[ali-h/jsonDoctor](https://github.com/ali-h/jsonDoctor)** — js, 42 files. A tool to broadcast and stream incoming custom_json transactions on Hive Blockchain
- **[MattyIce/postpromoter](https://github.com/MattyIce/postpromoter)** — js, 41 files. ```

## AI / MCP (1)

- **[gluneau/hive-mcp-server](https://github.com/gluneau/hive-mcp-server)** — ts, 76 files. An MCP server that enables AI assistants to interact with the Hive blockchain through the Model Context Protocol.

## Misc / Awesome-lists (7)

- **[openhive-network/wax](https://github.com/openhive-network/wax)** — py, 1872 files. An extension module to call hived cpp source code from Python and JavaScript.
- **[openhive-network/clive](https://github.com/openhive-network/clive)** — py, 1039 files. 1. [Introduction](#introduction)
- **[DoctorLai/steem-proxy-cloudflare](https://github.com/DoctorLai/steem-proxy-cloudflare)** — js, 53 files. A lightweight Cloudflare Snippet that automatically selects the healthiest Steem RPC node, ensuring stable, low-latency JSON-RPC access.
- **[Someguy123/hive-docker](https://github.com/Someguy123/hive-docker)** — ?, 53 files. **Hive-in-a-box** is a toolkit for using the Hive [docker images](https://hub.docker.com/r/someguy123/hive/tags/) published by @someguy123.
- **[reazuliqbal/HiveEngineExplorer](https://github.com/reazuliqbal/HiveEngineExplorer)** — js, 53 files. ```
- **[Someguy123/blurt-docker](https://github.com/Someguy123/blurt-docker)** — ?, 51 files. **Hive-in-a-box** is a toolkit for using the Hive [docker images](https://hub.docker.com/r/someguy123/hive/tags/) published by @someguy123.
- **[DoctorLai/awesome-steem](https://github.com/DoctorLai/awesome-steem)** — ?, 36 files. - [awesome-steem](#awesome-steem)

