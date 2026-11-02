# Desk

Two terminals. One friend. No server between them.

You get a person, a thread, a private note, an `0x` address, and a model that answers on the machine that asked. Same family as [Keet](https://keet.io), [Pear](https://pears.com), and [QVAC](https://qvac.tether.io). [tether.io/data](https://tether.io/data/) is the product page. This repo is the part you can run tonight.

Keet has calls, video, and files. This is the text slice, on a swarm that exists only so you can see the pieces.

## Run it

Node **22.17** or newer.

```sh
git clone https://github.com/Crisvond-hnt/desk.git
cd desk
npm install
npm run friends
```

The first terminal prints a short person key and an `0x` address. The person key is a Keet identity. The address is a WDK account. Two phrases, generated apart. Neither phrase is printed.

Same folder, second terminal:

```sh
npm run friends -- join
```

Wait until that terminal says `Admitted. You can write.` Type on either side. The other side labels your line `friend`.

```text
/note the dock at 7
/ask what did they just say, and what does the note add
/card
```

`/note` is an Autopass record. The other process paired with the invite before you typed, so the note shows up there too. `/ask` sends the thread and the note to Qwen3 0.6B Q4 through `@qvac/sdk` 0.23. The answer is printed here and is not appended to the thread. The first ask downloads about 382 MB into `.qvac/`. `/card` prints the person key and the address again.

Model only, no second terminal:

```sh
npm run friends -- --ask "Name one ocean. Answer in exactly three words."
```

Phrases from a real run sit in `tmp/friends-a/secrets.json` and `tmp/friends-b/secrets.json`, mode `0600`. Leave that directory alone.

## One layer at a time

The desk is three programs that also run by themselves.

### A room

```sh
npm run chat
```

```sh
npm run chat -- join
```

Wait for `Admitted. You can write.` Lines arrive as `> ...`.

The host opens a local HyperDHT (`hyperdht/testnet`). Two processes on one laptop usually fail to hairpin through the public DHT, so the lab does not start there. They swarm on the room's **discovery key** and wait until `join().flushed()`. The joiner cannot append until the host writes `{ addWriter: "<their key as hex>" }`. Put a raw Buffer in that JSON and it becomes `{ type: "Buffer", data: [...] }`. Autobase throws. Hex is the whole trick. `apply` only updates the view. No clock, no fetch.

Two computers, public DHT:

```sh
npm run chat -- --public
npm run chat -- join <room key from the first machine> --public
```

Public mode does not admit the second writer for you. The join still replicates what the host already wrote. Handing a writer key across the public network is the next experiment.

### A vault

```sh
npm run vault
```

```sh
npm run vault -- join
```

The second process prints `Note: left this on the vault`. The invite string is a capability. Keep it out of tickets and screenshots. This is [autopass](https://github.com/holepunchto/autopass), the library under PearPass. It is not the PearPass app.

### A second seed

```sh
npm run wallet
```

An `0x` address, two word counts, and `same phrase false`. No transaction leaves the machine. The chain is not a Hypercore. The provider in `gold/wallet.mjs` is a dummy localhost URL, because deriving an address does not need a receipt.

## Honest limits

| Easy thing to claim | What this repo actually is |
| --- | --- |
| Keet | Text between two processes on one machine |
| QVAC, the catalog | One local model, Qwen3 0.6B Q4, and only when you `/ask`. Do not `import('@qvac/inference')` from Node. That package is Bare-only. |
| Install this `pear://` | `pear touch` prints a link. Someone has to stay awake and `pear seed`. Clone and `npm install` is the path that works today. |
| Holesail as a dependency | The CLI is the demo: `npx holesail --live 3000`, then `npx holesail --connect hs://… --port 4000`. `require('holesail-server')` on Node 22 dies on `bare-dgram`. |
| Northern Data | No module. It is how Tether funds the machines. |

## Where the recipes live

`gold/room.cjs`, `gold/vault.cjs`, and `gold/wallet.mjs` are copied, not rewritten. `apply` is the reducer from the skill.

Agents install that skill on its own:

```sh
npx skills add Crisvond-hnt/tether-p2p
```

[Crisvond-hnt/tether-p2p](https://github.com/Crisvond-hnt/tether-p2p)

If this demo and the docs disagree, trust [docs.pears.com](https://docs.pears.com) and [docs.qvac.tether.io](https://docs.qvac.tether.io).
