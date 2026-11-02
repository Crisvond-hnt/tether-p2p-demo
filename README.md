# Tether P2P

One install. A code you send to a friend. A thread, a note, an address, and a model on the machine that asked.

```sh
git clone https://github.com/Crisvond-hnt/tether-p2p-demo.git
cd tether-p2p-demo
npm install
npm start
```

The window opens on this computer. Press **Start a thread with a friend**. Copy the code and send it to one person. They clone the same repo, run the same two commands, and paste the code. When their window says **You can write**, a line typed on either side shows up on the other.

Save note keeps one private line both of you can read. Ask this machine answers from the thread with a model that stays on the computer that asked. The page is `127.0.0.1`. It is the window. The lines live in a Hypercore. There is no account and no server holding the thread while both windows are closed, so leave yours open while you are talking.

The same code still works the next time you run `npm start` and start the thread again. The phrases stay in `tmp/`, mode `0600`. The window shows a short person key and an `0x` address, and it does not show the phrases.

If you are alone, **Try both sides on this computer** opens a second window on a private link. That pair does not reach a friend on another machine. Two processes on one laptop usually cannot punch a hole through the public network back to themselves, which is why the friend path is the one that leaves the machine.

Keet, Pear, and QVAC are the products this is cut from. Keet is the app with calls, video, and files. Pear is the runtime. QVAC is models on the device. The family page is [tether.io/data](https://tether.io/data/). This repository is the slice that has a `package.json` and runs on a laptop.

## Before you start

Node.js **22.17** or newer. Check with `node -v`. npm 10.9 ships with that Node.

```sh
git clone https://github.com/Crisvond-hnt/tether-p2p-demo.git
cd tether-p2p-demo
npm install
```

The install is Corestore, Hyperswarm, HyperDHT, Autobase, Hyperbee, Autopass, `keet-identity-key`, a WDK Ethereum wallet, and `@qvac/sdk` 0.23. There is no chat API in that list.

## What the window is showing

The six labels are the stack, in the order they come up.

| Label | What it is |
| --- | --- |
| Identity | A Keet key from `keet-identity-key`. The phrase is not the wallet seed. |
| Room | A Hypercore log. Both of you write through Autobase. `apply` in `gold/room.cjs` is the reducer, and it is left as it was. |
| Link | Hyperswarm. With a friend, that is the public DHT. On this computer, it is a local testnet, because hairpinning the public DHT back to yourself usually fails. |
| Note | An Autopass vault, the same idea PearPass is built on. The code is the invite. |
| Address | A WDK Ethereum address from a second seed. Nothing is sent. |
| Model | Qwen3 0.6B Q4 through `@qvac/sdk` 0.23, the first time you press **Ask this machine**. About 382 MB, into `.qvac/`. The answer is not written into the room. |

Your lines sit on the right. The friend’s lines sit on the left. **Quit** closes that window’s process.

The same sitting still runs in a terminal if you want the log:

```sh
npm run friends -- --cli
npm run friend -- --cli
```

The same sitting still runs in a terminal if you want the log:

```sh
npm run friends -- --cli
npm run friend -- --cli
```

`/note` stores one Autopass value at the key `desk-note`. The join paired with the invite before you typed, so the other process prints `note    the dock at 7`. The invite sits in `tmp/friends-session.json`, also mode `0600`. Treat it like a password. Anyone who has it can pair.

`/ask` takes the lines already in the room, plus the note, and runs Qwen3 0.6B Q4 (`QWEN3_600M_INST_Q4`) through `@qvac/sdk` 0.23. The SDK starts a Bare worker for you. Importing `@qvac/inference` yourself from Node throws `require.addon is not a function`, because that package is Bare-only. The first ask downloads about 382 MB into `.qvac/`. The next ask uses the file that is already there. The answer is printed with an `aside` prefix. It is not written into the room.

`/card` prints the person key and the address again.

If you only want the model:

```sh
npm run friends -- --ask "Name one ocean. Answer in exactly three words."
```

## Just the room

```sh
npm run chat
```

Read the room key it prints. Second terminal:

```sh
npm run chat -- join
```

Wait for `Peer connected.` and then `Admitted. You can write.` Lines show up as `> ...`.

The host builds a small HyperDHT on the machine with `hyperdht/testnet`. Two processes on one laptop usually fail to punch a hole through the public DHT back to themselves, so the demo starts on that local testnet. Both sides swarm on the room's discovery key and block on `join().flushed()`. An earlier version called `listen()` and then `flush()`, and it sat there for half a minute with zero peers.

The joiner cannot append yet. The host appends `{ addWriter: "<hex>" }`. The key has to be a hex string. JSON turns a raw Buffer into `{ type: "Buffer", data: [1, 2, 3] }`, and Autobase throws on that. `apply` in `gold/room.cjs` writes the view and then returns. It does not call the network, read a clock, or touch a global.

Two machines, on the public DHT:

```sh
npm run chat -- --public
npm run chat -- join <room key from the first machine> --public
```

On `--public` the host does not add the second writer. The join still replicates the lines the host already stored. Carrying a writer key from one computer to the other is the next piece of work.

## Just the vault

```sh
npm run vault
```

```sh
npm run vault -- join
```

The second process prints `Note: left this on the vault`. The library is [autopass](https://github.com/holepunchto/autopass), which is what PearPass is built on. This script is not the PearPass app, and it does not create an account. The invite string printed by the first process is enough to pair. Do not put it in a ticket.

## Just the address

```sh
npm run wallet
```

You get an `0x` address, two word counts, and the line `same phrase false`. The Keet phrase and the WDK seed are generated separately. No transaction is signed. The chain is not a Hypercore. `gold/wallet.mjs` points the provider at `http://127.0.0.1:1` because reading an address off a seed does not need a receipt.

## What is in the tree

| Path | What it is |
| --- | --- |
| `friends.mjs` | Room, vault, identity, address, and `/ask` in one process |
| `chat.mjs` | The room on its own |
| `vault.mjs` | One Autopass invite and one note |
| `wallet.mjs` | Two seeds, one address |
| `aside.mjs` | The Qwen3 call through `@qvac/sdk` |
| `lib.mjs` | Corestore, swarm, the session file, and the `0600` writes |
| `gold/room.cjs` | The Autobase room. `apply` is copied and left as it was |
| `gold/vault.cjs` | Create an Autopass vault, or pair from an invite |
| `gold/wallet.mjs` | Derive the Ethereum address |
| `tmp/` | Session files and the phrases. Git ignores this |
| `.qvac/` | The weights. Git ignores this |

Those three gold files are the room, the vault, and the address. The skill copies each one when the app needs it, and it also carries the QVAC worker and the Holesail path. The skill is for composing an app, not for repeating this sitting:

```sh
npx skills add Crisvond-hnt/tether-p2p
```

The skill repo is [Crisvond-hnt/tether-p2p](https://github.com/Crisvond-hnt/tether-p2p).

`package.json` pins the versions this sitting was run with: Autobase 7, Autopass 3, Hyperswarm 4, HyperDHT 6, Hyperbee 2, Corestore 7, `@qvac/sdk` 0.23, `keet-identity-key` 3.2, and the WDK 1.0 betas. If a sentence here and a page on [docs.pears.com](https://docs.pears.com) or [docs.qvac.tether.io](https://docs.qvac.tether.io) disagree, the docs are the ones to follow.

## What a demo of this size can show

A signed log with two writers. A vault opened by an invite. An address from a seed the user holds. A model that never receives an API key.

Keet's calls and video are not in this tree. A `pear://` link is not either: `pear touch` prints a link, and a separate `pear seed` process has to stay up to serve it. `git clone` and `npm install` is the path that works while you are sitting here.

Holesail from the command line works: `npx holesail --live 3000`, then `npx holesail --connect hs://… --port 4000`. Importing `holesail-server` on Node 22 dies on `bare-dgram`, so this repo does not require it.

Northern Data is how Tether pays for the machines. There is no package to import.
