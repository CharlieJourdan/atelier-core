# 0038. The beta rule on models: agents and scripts on a subscription only, the director on the subscription or the API key
Date: 2026-11-01. Status: accepted. Decided by: Charlie (« pour la beta fais en sorte que la possibilité de faire les agents
ou encore les scripts c'est seulement si on a un abonnement llm type claude code ou codex connecté et pour la partie director
c soit api ou soit l'abonnement claude du mec »), settled by the beta-agents-llm session.

## Context
On 1 Nov. Charlie wrote to Atlas « regarde si j'ai des vidéos en cours de production » and never got an answer. His installed
app (33aceb9) had two Claude Code accounts: account 1, « connexion par défaut », made automatically at first launch (the CLI's
default login, never « Vérifier », priority 0), and account 2 (its own config folder, verified, priority 2). The default
login's OAuth session had expired. The pool picked by priority, so account 1 took every turn; « Failed to authenticate: OAuth
session expired » was an ordinary failure (backoff), so both the digest and Charlie's message burnt their 3 attempts on the
dead login and died, while account 2 sat idle. Evidence: `orch_events` 8–31 of his database (copy read 1 Nov.).
Besides, every LLM feature outside the agents' turns went to `getProvider('claude-code')` = that same default login.

## Decision
1. **The agents** (team, Atlas chat, the switch, the planner) and **every LLM feature but the director** (script writing:
   `script.write`, research, fact check, sponsor read; ideas, support videos, analysis, the money builders, the pipeline
   agent) run **only on a connected, working Claude Code or Codex subscription account** of the agents' pool. Never the API
   key, never the relay, during the beta. Without one they are locked: a card « Branche ton abonnement Claude ou Codex » with
   a button to Réglages › Claude (Équipe, Messages, Production › Nouvelle vidéo), and a French error for any call.
2. **The director** (every engine role but the script's four: scenes, cuts, chapters, sponsor card, packaging, and the
   beats of an imported script) runs on the user's subscription or on the Anthropic API key (billed to the user, per token,
   shown on the run quote's director nodes as `api-key`). Setting `llm.directorBackend` (Réglages › Claude › « Le
   réalisateur »); default: the subscription when one works, else the key when one is set. The key is the providers' secret,
   else the default « API » profile of Réglages › Claude.
3. **Imported scripts** stay free and always available: their tagging pass follows the director's backend, and with no model
   at all the script goes through with plain beats (a warning says so).
4. **Account health.** A verified account goes before one that never passed « Vérifier ». A login refusal (expired OAuth,
   « Not logged in », invalid key, CLI missing) marks the account « À reconnecter » (state `login`, switched off) and the same
   attempt moves to the next account; no retry is ever spent on a dead login. With no working account the task waits (reason
   `accounts`, attempt given back), the agent answers in the chat at once with what to click (Réglages › Claude ›
   Reconnecter) and keeps the message; a good « Vérifier » releases the waiting tasks and brings back the dead letters of a
   dead login of the last day. The app's other LLM calls run on the same pool through `SubscriptionProvider`, with the same
   failover.

## Consequences
- `orchestra.kindPreference` can no longer give an agent's turn to the API key or the relay (the pool filters them out).
- Beta testers need Claude Code or Codex logged in to use agents or write scripts; importing a script and rendering it on an
  API key works without either.
- After the beta, the rule can be lifted (credits through the relay, decision 0026) by widening `AGENT_ACCOUNT_KINDS`
  and `SCRIPT_ROLES` in `src/main/orchestra/accounts.ts` and `src/main/llm/access.ts`.
- Code: `src/main/llm/access.ts`, `src/main/orchestra/subscription.ts`, `account-health.ts`, `accounts.ts`, `turn.ts`,
  `supervisor.ts`, `src/main/production/claude.ts`; UI `SubscriptionLock.tsx`, `DirectorBackendPanel.tsx`; strings
  `src/shared/fr-llm-access.ts`. Tests: `tests/unit/beta-agents-llm.test.ts`, `tests/e2e/beta-agents-llm.spec.ts`.
