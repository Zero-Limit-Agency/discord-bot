# Zero Limit Agency — Discord Bot V1

Builder de serveurs et modules Discord sous licence manuelle. **La validation commerciale finale reste ouverte** : voir [le suivi unique](docs/audit/v1-final-review.md). Les tests déterministes et une intégration API Discord passent ; aucun build IA réel n'a été exécuté dans cet environnement.

## Installation

Node.js **24.5+**, un seul processus, un disque persistant. Ne pas exécuter deux instances sur les mêmes fichiers JSON.

```bash
npm ci
cp .env.example .env
npm run verify-safe
```

Renseigner dans `.env` :

- `DISCORD_TOKEN` : token du bot, jamais versionné.
- `ZERO_LIMIT_OWNER_IDS` : IDs utilisateurs Zero Limit, séparés par des virgules. Une liste vide refuse tout build et toute gestion de licence, même aux administrateurs Discord.
- `CLIENT_ID` : identifiant de l'application Discord.
- `GUILD_ID` : serveur visé pour l'enregistrement des commandes ; `COMMAND_SCOPE=guild` par défaut.
- `AI_PROVIDER` et le modèle correspondant, pour `/build`.
- `DISCORD_TEMPLATE_EXECUTION_ENABLED=true` pour autoriser les créations réelles.

Dans le Developer Portal, activer **Server Members Intent**. Le bot utilise aussi Guilds, Guild Voice States et Guild Messages. Pour les transcriptions complètes des messages des membres, activer **Message Content Intent**, puis `MESSAGE_CONTENT_ENABLED=true`. Sans cela, les transcripts peuvent manquer le contenu des messages des membres ; le bot peut démarrer sans cet intent optionnel.

Inviter avec les scopes `bot` et `applications.commands`. Permissions nécessaires selon les modules : View Channels, Send Messages, Embed Links, Attach Files, Read Message History, Manage Channels, Manage Roles, Move Members, Connect. Placer le rôle du bot au-dessus des rôles qu'il doit attribuer. Ne pas accorder Administrator par défaut. Forums et annonces exigent un serveur Community déjà configuré dans Discord.

```bash
npm run register-commands
npm start
```

L'enregistrement ajoute/met à jour les commandes connues, sans supprimer les autres entrées de l'application. Pour tous les serveurs clients, choisir explicitement `COMMAND_SCOPE=global` et relancer l'enregistrement. Cela affecte tous les serveurs où l'application est installée ; les tests de cette mission ont utilisé exclusivement la portée guild du serveur Test.

## Providers IA

| Provider | Configuration |
| --- | --- |
| LM Studio | `AI_PROVIDER=lmstudio`, `LMSTUDIO_BASE_URL`, `LMSTUDIO_MODEL` ; ancien `LMSTUDIO_ENABLED=true` reste compatible |
| Ollama | `AI_PROVIDER=ollama`, `OLLAMA_BASE_URL`, `OLLAMA_MODEL` ; endpoint compatible OpenAI `/v1/chat/completions` |
| NVIDIA NIM | `AI_PROVIDER=nvidia`, `NVIDIA_BASE_URL`, `NVIDIA_MODEL`, `NVIDIA_API_KEY` |

Le modèle doit déjà être disponible. Aucun téléchargement ni basculement automatique vers une API payante. Un provider absent/indisponible donne un échec explicite. Le mode `single` utilise un appel ; `BUILD_PIPELINE_MODE=multi` conserve les agents architecte, permissions, contenu et l'assemblage déterministe. Les retries multi sont limités à trois et peuvent être désactivés avec `BUILD_AGENT_MAX_RETRIES=0`. Les timeouts agents sont alignés avec le timeout du transport. Les erreurs HTTP ne révèlent ni clé ni corps de réponse.

Les références locales importables sont dans `templates/references/library.json` (`id`, `tags`, `guidance`). Elles couvrent esport, creator, premium, gaming, community, corporate et academy. Le brief prime ; aucun lien d'invitation n'est inspecté et aucune référence n'exécute d'action.

## Construire et livrer

```text
/build prompt:<brief du client>
/build-status run:<identifiant du run>
/template-create template:<slug validé> confirm:true
```

Les commandes build, template et les anciens outils de publication des textes de l'agence sont réservés aux propriétaires Zero Limit. `/announce` exige une licence embeds et un administrateur.

Pipeline réel : normalisation du brief → IA → normalisation/réparation du template → validation → preview/plan/dry-run → politique et collisions → création Discord → relecture des ressources et permissions. Les salons reçoivent leurs permissions dès leur création. Le bot refuse les collisions ; il ne réutilise ni n'écrase silencieusement une ressource existante.

Le résultat contient `staticServer` (mapping des rôles/salons/messages natifs) et `botFeatures` (état des propositions dynamiques). Le planner peut configurer welcome, goodbye, tickets, logs et tempvoice si leurs références sont résolues et leur licence active. Les autres propositions, les références absentes ou la configuration refusée restent explicitement à configurer dans `/panel`. Le builder ne modifie pas les paramètres Community, le nom ou l'icône de la guild et ne met pas en place le parcours natif Discord Onboarding.

Un run long continue après expiration de l'interaction. Le rapport tente une livraison par DM à son demandeur si nécessaire ; `/build-status` reste disponible. Au redémarrage, un run interrompu devient failed, avec son mapping conservé. Pas de reprise automatique ni de rollback destructif. Examiner les objets déjà créés avant de relancer.

Le rôle `1534218992619753622` et les IDs de `PROTECTED_ROLE_IDS` sont protégés. **Discord insère les nouveaux rôles au bas de la hiérarchie et décale les positions existantes.** Le builder bloque un plan créant des rôles lorsqu'un rôle protégé de position supérieure à zéro est présent. Il ne déplace jamais ce rôle pour compenser. Autoroles et menus refusent aussi de l'attribuer.

Le contenu natif reste après retrait du bot. Les fonctions dynamiques demandent le bot connecté et une licence active.

## Licences et administration

Sur le serveur du client, avec un compte présent dans `ZERO_LIMIT_OWNER_IDS` :

```text
/license activate days:30 features:panel,tickets,welcome,goodbye,embeds,tempvoice,autoroles,rolemenu,logs
/license status
/license extend days:30
/license features features:panel,tickets,embeds
/license disable
```

Les licences sont liées à la guild courante. L'expiration et la désactivation refusent les commandes, composants, formulaires et automatisations concernées, sans supprimer les configurations ou ressources. Une réactivation retrouve les données. Facturation et renouvellements restent manuels.

Un administrateur client disposant de la feature `panel` lance `/panel`. Avec l'option `channel`, le bot publie un panel persistant, à placer de préférence dans un salon privé d'administration. Les formulaires préremplis montrent les clés JSON attendues : remplacer les IDs, adapter les textes et enregistrer. Chaque sauvegarde valide les salons, types, rôles, hiérarchie et licence. Le mode développeur de Discord permet de copier les IDs. Pour désactiver un module, passer `enabled` à `false` ; ses autres paramètres restent conservés.

- **Tickets** : 1–5 types, catégorie, rôles staff et maximum de tickets ouverts. Bouton → formulaire → salon privé. Claim/unclaim et reopen sont réservés au staff ; le demandeur peut fermer son ticket. Fermer conserve le salon et retire le droit d'écrire au demandeur. Transcripts réservés au staff, fichiers locaux privés, téléchargement éphémère, maximum de 1000 messages et métadonnées des pièces jointes seulement. Redémarrage : récupération des créations interrompues et des contrôles manquants.
- **Welcome / Goodbye** : salon principal, fallback facultatif et message texte/embed. Placeholders : `{user}`, `{username}`, `{server}`, `{memberCount}`. Aucune réutilisation de la configuration d'une autre guild ; un salon absent sans fallback entraîne un message de diagnostic et un envoi ignoré.
- **Embeds** : presets nommés, save/preview/send/edit dans le panel. Schéma `{"content":"", "embed":{"title":"Bonjour {server}","description":"Texte","color":"#7A1632","fields":[{"name":"Info","value":"Contenu"}],"footer":{"text":"Footer"},"image":"https://example.com/image.png"}}`. `thumbnail` accepte aussi une URL HTTPS. Modifier un message exige son ID et un message appartenant au bot. Un embed seul est valide. Mentions automatiques désactivées.
- **Temp Voice** : salon vocal Join-to-Create, catégorie et limite initiale. Le propriétaire utilise `/voice rename`, `limit`, `lock`, `unlock`, `transfer`. Les salons vides créés par le bot sont supprimés ; les autres sont préservés. Licence expirée : aucune suppression automatique. Réconciliation au redémarrage ou à l'événement vocal suivant, si le module est actif.
- **Autoroles / Role Menu** : rôles sans privilèges sensibles, sous le bot. Menus : `buttons` ou `select`, 1–5 rôles. Panels persistants, revalidation avant attribution, modification incrémentale des rôles du membre.
- **Logs** : salon par guild ; arrivées/départs, rôles, salons, tickets, configuration, embeds et licences. Journal local limité à 1000 actions, sans contenu de conversation.

## Stockage, exploitation et tests

Conserver `.data/` **et** `templates/drafts/` sur disque persistant et faire des sauvegardes privées hors Git. Les JSON commerciaux sont atomiques (temporaire, fsync, rename), isolés par guild, avec permissions locales 0600. Un fichier corrompu ou une version inconnue bloque les accès concernés ; restaurer une sauvegarde, ne pas remplacer arbitrairement le fichier par `{}`. Le verrou `.data/bot.lock` refuse une deuxième instance et récupère un PID mort. Il suppose une seule machine/espace de PIDs ; ne pas partager le volume entre réplicas.

Les mappings de builds sont dans `.data/build-jobs/`. Un résultat partiel n'autorise pas la suppression de ressources préexistantes. Les transcripts sont dans `.data/commercial/transcripts/`. Restreindre l'accès aux sauvegardes, fixer une politique de conservation et supprimer les exports devenus inutiles par procédure opérateur. Les dossiers `debug/`, `.data/`, les brouillons et `.env*` sont exclus de Git. En production, `NODE_ENV=production` désactive les dumps de génération.

```bash
npm run verify-safe
# Test API réel, uniquement Test, sans IA ; crée puis nettoie ses propres salons :
ZLA_LIVE_TEST_GUILD_ID=1519795418429390908 npm run verify-discord-live
```

`verify-safe` n'appelle ni Discord ni une API IA. Le smoke live utilise des interactions synthétiques et des licences de test isolées : il ne remplace pas les clics réels, les événements join/leave ou un membre rejoignant un vocal. Voir le suivi pour les preuves et limites exactes.

Les anciens watchers site/social ne démarrent que si `LEGACY_MONITORS_ENABLED=true`. Ils sont destinés à l'ancien serveur de l'agence ; ils ne constituent pas des modules clients sous licence. Aucun hébergement ni service payant n'est installé par ce dépôt.
