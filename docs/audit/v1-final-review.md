# V1 — Revue finale et livraison

Date : 5 novembre 2026 (Europe/Paris). Version package : 1.0.0. Statut commercial : **NOT READY** pour annoncer une V1 intégralement validée et livrer immédiatement un premier client avec `/build`.

## A. État réel du dépôt et du bot

- Dépôt monté : `/workspace/discord-bot`. Remote canonique vérifié : `Zero-Limit-Agency/discord-bot`, organisation GitHub privée. L'ancien chemin `ZeroLimitAgency/discord-bot` redirige vers ce dépôt.
- Base : `7be2224`, dernier `origin/main` après fetch. Branche initiale `work`, sans changement local ni commit en avance sur main. Aucune branche distante commerciale historique n'est disponible. Le dossier Windows et ses éventuels commits locaux ne sont pas accessibles depuis cet environnement.
- Branche de livraison : `codex/discord-bot-v1-finalization`. Aucun changement direct sur main ; aucun deuxième dépôt.
- Le dépôt reçu contenait le builder, le pipeline multi-agent LM Studio, normalisation/réparation, mapping et tests. Il ne contenait ni les modules commerciaux, ni les entitlements, ni NVIDIA/Ollama, ni `docs/`. Les documents disponibles étaient README, DEPLOYMENT-CHECKLIST, TRANSITION et les doctrines `src/ai-skills/` ; ils ont été confrontés au code.
- Le bot a réellement atteint `clientReady` sur Discord, avec `ALLOWED_GUILD_IDS=1519795418429390908`. Ce processus de validation a été arrêté ; aucun déploiement permanent n'a été effectué.
- Les 17 commandes ont été ajoutées/mises à jour puis relues via l'API sur **Test seulement**. Aucune commande globale n'a été déployée. Les publications historiques de textes de l'agence et les outils template sont désormais owner-only ; `/announce` est admin + licence embeds.

`/build` est maintenant relié à la création réelle, au journal de ressources, à la relecture Discord et au rapport final. Un build complet sur adaptateur simulé passe. **Aucun build IA réel n'a été lancé** : aucun owner/provider n'est configuré dans ce runtime, et la position strictement protégée du rôle `all` empêche l'insertion de nouveaux rôles sur Test.

## B. Constats et corrections — passe unique

| Priorité | Constat vérifié dans la base reçue | Correction / état |
| --- | --- | --- |
| P0 | `/build` et `/template-create` accessibles au staff ou à tout administrateur client | Contrôle strict de `ZERO_LIMIT_OWNER_IDS`, refus si vide ; même contrôle sur les outils template et anciens outils de publication de l'agence |
| P0 | Salons privés créés avant leurs overwrites, donc fenêtre d'exposition possible | Permissions résolues et envoyées dans la requête de création ; catégories initialement privées, accès explicite au bot |
| P0 | Aucune protection intégrée de la position du rôle `all` | Snapshot avant/après ; refus avant mutation si l'insertion de rôles déplacerait une position protégée ; attribution de rôles protégés interdite dans les modules |
| P0 | Absence de licensing et d'isolation commerciale | Store par guild, owner-only pour licences, admin-only pour configuration, gate sur commandes/composants/modals/événements ; expiration non destructive |
| P0 | Publication `/announce` constituait un chemin alternatif pour les embeds | Licence embeds et administrateur requis ; contrôle du serveur cible, longueur des entrées et URL d'image |
| P0 | Dépendances installées : 2 vulnérabilités high et 2 moderate signalées par npm | Mise à jour compatible ; discord.js 14.28.1 minimum, lock actualisé, audit final : zéro vulnérabilité signalée |
| P1 | `/build` finissait au brouillon/dry-run sans créer de serveur | Exécution réelle après validation/policy/preflight ; mapping persistant, arrêt au premier échec et relecture des permissions |
| P1 | Génération absente/invalide pouvait aboutir à un job completed | Échec explicite et persisté ; pas d'exécution ni de rapport de livraison réussi sans template et dry-run valides |
| P1 | Modules dynamiques absents | Tickets, welcome/goodbye, presets d'embeds, tempvoice, autoroles, menus de rôles, logs et panel implémentés et raccordés |
| P1 | Providers limités à LM Studio | Sélection centralisée LM Studio/Ollama/NVIDIA, même client borné ; pas de fallback payant automatique |
| P1 | WebSocket discord.js ignorait le proxy cloud, empêchant clientReady | Transport d'upgrade routé via le proxy HTTPS hérité, TLS conservé ; connexion Discord réelle ensuite obtenue |
| P2 | Réponses/attachments non bornés au téléchargement ; redirects acceptés | Limite 2 Mio pour réponses IA ; lecture bornée des pièces jointes, CDN Discord seulement, redirections refusées |
| P2 | `BUILD_AGENT_MAX_RETRIES=0` devenait 1 | Zéro respecté ; plafond de trois retries multi |
| P2 | Risque de journal mensonger après une exécution réussie mais une vérification échouée | États executionStatus/verifying/success séparés ; lastBuild seulement après vérification |
| P2 | Références et opérations peu documentées | Bibliothèque JSON simple, sélection déterministe, README et checklist d'installation actualisés |
| P3 | Dashboard, paiements automatisés, économie, analytics avancées | Hors périmètre ; non développés |

Aucune sortie IA brute n'est passée à Discord. Le pipeline existant a été conservé : normalisation, réparation, validation, payload, plan et dry-run ; les garde-fous live sont partagés par les deux points d'entrée. Une référence de permission perdue à la réparation bloque le live. Collisions, limites de rôles/salons, catégorie >50 salons et exigences Community sont vérifiées avant création. L'ordre des rôles nouvellement créés est appliqué explicitement ; aucune reprise destructive ou suppression globale.

## C. Fonctionnalités — preuves et limites

« Safe » signifie tests déterministes, avec Discord simulé et stockage temporaire. « API live » signifie appels Discord réels sur Test, avec objets de test et interactions synthétiques. Aucun de ces termes ne signifie qu'un clic utilisateur a été observé.

| Module | Code opérationnel / preuve | Validation restant à faire / limites V1 |
| --- | --- | --- |
| Build | Safe : brief/template → normalisation/réparation/validation → dry-run → exécution → vérification → mapping ; refus collisions/protection | Génération IA et serveur complet en live non testés. Nom/icône/paramètres de guild et Discord Onboarding natif non automatisés ; onboarding par messages/embeds |
| Jobs longs | Persistance existante conservée et durcie ; heartbeat, DM de secours et `/build-status` ; redémarrage simulé couvert par tests existants | Redémarrage marque failed ; pas de reprise automatique. Objets d'un run partiel conservés et mappés |
| Tickets | Safe + API live : panel/formulaire côté service, création privée, demandeur/staff, limite concurrente, claim/unclaim, fermeture, réouverture, transcripts, logs | Clic/modal d'un humain et redémarrage d'une session Gateway avec ticket en cours non observés ; tests de reprise déterministes. Transcript limité à 1000 messages et métadonnées des pièces jointes ; Message Content intent nécessaire pour contenu complet des membres |
| Welcome / Goodbye | Safe : isolation, placeholders, fallback, autoroles, expiration. API live : vrais envois des deux messages | Événement réel join/leave non provoqué. Salon absent sans fallback : envoi ignoré avec diagnostic |
| Embeds | Safe : presets sauvegardés, preview, send/edit, couleur/fields/image/thumbnail/footer/placeholders ; embed seul accepté. API live : envoi/modification/relecture | Actions de formulaires Discord par utilisateur non observées ; images HTTPS seulement |
| Temp Voice | Safe : Join-to-Create, propriétaire, renommage, limite, lock/unlock, transfert, suppression vide, mapping et reprise. API live : création/renommage/limite/suppression du vocal de smoke | Un membre n'a pas rejoint de vocal ; aucun test live du déplacement, transfert ou nettoyage automatique avec événements Gateway |
| Autoroles / Role Menus | Safe : auto-attribution, boutons et select, panels persistants, hiérarchie, refus privilèges et rôle protégé, retrait incrémental | Attribution live non effectuée : aucun rôle créé/modifié et aucun membre ajouté/retiré du rôle protégé |
| Logs | Safe : journal de métadonnées borné, canal par guild et erreur réseau. API live : actions du smoke et tickets | Acteur inconnu représenté par bot/inconnu ; pas d'attribution inventée à partir des audit logs Discord ; contenu des conversations exclu |
| Panel Discord | Safe : admin/entitlement, modals JSON et refus module non licencié. API live : message et composants acceptés | Configuration préremplie en JSON dans les modals ; recette humaine nécessaire. `/panel channel:` publie le panneau persistant |
| Licensing | Safe : activate/extend/disable/status/features, expiration, flags, isolation. API live : refus puis reprise du backend tickets avec licence isolée, ressources conservées | Les slashs owner-only n'ont pas été exécutés par un humain. Le smoke ne touche pas aux licences commerciales existantes |
| Références | 7 familles JSON, import simple, recherche bornée, intégrée aux prompts single et architecte multi ; test safe | Inspiration uniquement ; pas de snapshots de guild, crawling, inspection d'invites ou recherche vectorielle |

Le planner sépare `staticServer` des `botFeatures`. Il configure welcome/goodbye/tickets/logs/tempvoice si les références et entitlements le permettent. Les propositions autoroles/menus ou références non résolues restent signalées `needs-configuration` dans le rapport et se configurent par `/panel`. Un module absent de la licence est signalé `license-required` ; aucune activation cachée.

## D. IA

| Provider | Validation effective |
| --- | --- |
| NVIDIA NIM | Sélection, modèle, Authorization et réponses/erreurs testés sur fetch simulé. Aucune clé NVIDIA disponible ; aucun appel réel, crédit ou benchmark |
| LM Studio | Transport compatible et streaming testés, intégration au pipeline existant conservée. Service/modèle non configurés dans ce cloud ; aucun appel réel |
| Ollama | Endpoint compatible OpenAI et sélection du modèle testés sur fetch simulé. Service/modèle non configurés ; aucun appel réel |

Provider utilisé en live : **aucun**. Les timeouts, HTTP 503, erreur réseau, réponse vide/malformée et taille excessive sont simulés. Un modèle mal configuré ne déclenche aucune mutation Discord. Aucun modèle téléchargé.

## E. Sécurité et persistance

- Owner-only indépendant des permissions d'administration du client. Configuration revalide le membre administrateur dans la guild de l'interaction.
- Licence courante et feature requises dans commandes, boutons, menus, modals, événements join/leave/vocaux et attributions de rôles. Recontrôles après attente des queues sensibles. Aucune suppression déclenchée par l'expiration.
- Stockage commercial JSON version 1 par snowflake de guild ; mutations synchrones et renommage atomique avec fsync, fichiers 0600/répertoires 0700. Les queues sérialisent créations de tickets, vocaux, configuration et rôles. Un verrou de runtime refuse les doubles processus sur une machine.
- Corruption/version inconnue : échec fermé et restauration opérateur depuis sauvegarde privée, sans remise à zéro silencieuse. Les temporaires d'une écriture interrompue ne sont pas lus comme données valides. Pas de migration SQL imposée ; interface read/update isolée dans un repository.
- Mono-instance locale : pas de promesse de verrou distribué, de NFS ou de multi-réplicas. Protéger le volume et les sauvegardes. Les erreurs d'un event sont capturées ; une guild défaillante ne termine pas le processus. Une exception réellement non capturée provoque un arrêt pour redémarrage par superviseur.
- Autoroles et menus refusent les rôles privilégiés, gérés, protégés ou au-dessus du bot. `@everyone` est exclu des rôles attribuables/staff tickets.
- Transcripts privés locaux et téléchargement éphémère staff ; pas de publication dans un salon public. Conservation et sauvegardes sous responsabilité opérateur, pas de purge destructive implicite.
- Mentions désactivées dans les contenus générés et modules. `/announce` n'autorise une mention de masse que sur demande explicite d'un administrateur et avec les permissions du bot.
- Pas d'accès filesystem depuis des IDs non validés. Attachments limités aux CDN Discord et tailles bornées. Références locales traitées comme inspiration, jamais comme autorisations.
- Secrets connus expurgés du logger et des erreurs d'interactions. `.env*`, `.data/`, `debug/`, `templates/drafts/` exclus du suivi Git ; aucun de leurs contenus n'est livré.

## F. Validation effectuée

1. `npm run verify-safe` : **PASS**, suites existantes conservées et **24 scénarios commerciaux** ajoutés. Le dernier passage complet comprend ordre des rôles, chemins alternatifs de licensing, protection et proxy. Aucun serveur Discord ni provider IA appelé par cette commande.
2. `npm audit` : **0 vulnérabilité signalée** après mises à jour compatibles et ajout du support proxy.
3. Démarrage réel : commandes/events chargés et `Bot connected to Discord` obtenu ; processus autorisé sur Test seulement puis arrêté. Le Gateway a initialement échoué à cause du proxy ; la correction de transport a résolu cet échec. Aucun intent privilégié optionnel ajouté sans configuration.
4. Commandes : **17 enregistrées et 17 relues** sur Test, dont build/license/panel/voice/build-status. L'enregistrement ajoute/met à jour sans effacement massif. Les changements ultérieurs de restrictions de schéma restent aussi vérifiés par sérialisation safe ; les gates runtime s'appliquent indépendamment du schéma enregistré.
5. Smoke API réel unique : run `live-cbd70bbd-5ff5-4033-a88c-598624b2e599` sur `1519795418429390908`. Embeds send/edit/refetch, panel natif, welcome/goodbye, backend tickets complet, licence désactivée/réactivée et vocal natif : **PASS** aux limites du tableau ci-dessus.
6. **4 salons créés, 4 nettoyés**, uniquement via les IDs du mapping de ce run. Aucun rôle créé ou modifié. Snapshot avant/après du rôle `all` : nom/couleur/permissions/position/membres identiques. Aucun objet du serveur principal modifié.
7. Les journaux détaillés du smoke, son mapping et les transcripts restent dans `.data/live-smoke/<run>/`, privés et exclus de Git. Aucune pièce jointe privée n'est publiée.

Les APIs de création de salons/permissions, composants, messages et commandes ont été effectivement exercées avec discord.js 14.28.1 sur l'API v10. Références officielles : [salons](https://discord.com/developers/docs/resources/channel), [commandes](https://discord.com/developers/docs/interactions/application-commands), [discord.js](https://discord.js.org/docs/packages/discord.js/14.28.1).

## G. Git et livraison

Commits de code :

- `cb95dad` — frontières owner, stockage commercial et protections de base.
- `1e305da` — modules licenciés et interactions persistantes.
- `727b445` — exécution des builds, providers, références, tests et transport proxy.

Documentation et exemple d'environnement livrés séparément. La branche de finalisation est destinée à une **PR brouillon vers main**, puisque la recette finale reste bloquée. Aucun merge, déploiement, achat ou message à un tiers. Les droits GitHub sur le dépôt ont été vérifiés ; le résultat du push et le lien de PR figurent dans la livraison du chat.

## H. Critères et décision commerciale

- [x] Démarrage réel obtenu avec token requis et variables optionnelles absentes.
- [x] Schémas sérialisables et commandes enregistrées sur Test.
- [x] Owner-only build/license et absence d'accès implicite admin client.
- [x] Validation/dry-run, ressources privées dès création et politique de collisions.
- [x] Jobs persistés, expiration d'interaction et redémarrage simulés.
- [x] Providers interchangeables au niveau transport, testés sans appels payants.
- [x] Isolation guild, permissions, licensing non destructif et protection testés.
- [x] Tests safe et audit dépendances passent ; documentation d'installation exploitable.
- [x] Validation API de plusieurs modules sur Test, rôle protégé intact, cleanup limité au run.
- [ ] Build IA personnalisé, livré et vérifié intégralement sur un serveur autorisé.
- [ ] Tickets, welcome/goodbye, embeds et panel vérifiés par un humain dans les interactions Discord réelles.
- [ ] Join-to-Create, contrôle/transfert/nettoyage vocal et rôles vérifiés avec de vrais membres, puis redémarrage et licence expirée/réactivée.
- [ ] Validation commerciale complète ; aucun module n'est annoncé ici comme intégralement certifié sur la seule base d'une configuration ou d'un mock.

**NOT READY**. Blocages réels avant validation commerciale :

1. Fournir/configurer `ZERO_LIMIT_OWNER_IDS` et un endpoint/modèle IA accessible et autorisé. Aucun provider gratuit local n'est configuré dans le cloud ; aucune API payante n'a été appelée. Effectuer ensuite un seul build IA complet.
2. Résoudre la contrainte de recette sur Test : `all` est en position 1 ; créer de nouveaux rôles décalerait cette position. Conserver ce refus de sécurité. Il faut soit un autre serveur de recette explicitement autorisé sans cette contrainte, soit une décision du propriétaire modifiant l'exigence sur la position absolue. Aucune modification du rôle protégé n'est autorisée par cette livraison.
3. Réaliser la recette humaine restante : clics/formulaires, join/leave, accès membre/staff, menus de rôles, entrée en vocal/transfert/nettoyage et redémarrage réel. Corriger tout défaut observé avant de déclarer READY. Les fonctions et leurs tests de service existent ; les événements humains ne peuvent pas être prouvés par ce smoke API.

Les limites documentées (JSON dans les modals, mono-instance, transcripts bornés, fonctions natives Discord manuelles et propositions de features à compléter dans le panel) ne sont pas des fonctionnalités cachées ni des preuves de validation live.
