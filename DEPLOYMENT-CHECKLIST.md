# Mise en service

- Node.js 24.5+ ; `npm ci`, puis `npm run verify-safe`.
- Un seul processus et un seul espace de PIDs pour le stockage JSON. Utiliser un superviseur avec redémarrage sur erreur et arrêt SIGTERM ; pas de clustering ou de réplicas sur le même volume.
- Compte système non privilégié ; répertoire de travail du dépôt ; `.env` ou secrets gérés hors Git. `NODE_ENV=production`.
- Disque persistant privé pour `.data/` et `templates/drafts/`, sauvegarde hors Git et restauration testée. Fichiers privés 0600 ; répertoires 0700.
- `DISCORD_TOKEN`, `CLIENT_ID`, `ZERO_LIMIT_OWNER_IDS`, provider/modèle et droits Discord configurés selon README. Vérifier Server Members Intent ; Message Content Intent pour transcripts complets. Rôle du bot au-dessus des rôles attribuables.
- Pour un processus de validation, `ALLOWED_GUILD_IDS=1519795418429390908`, `COMMAND_SCOPE=guild`, `GUILD_ID=1519795418429390908`, watchers historiques désactivés. Ne jamais enregistrer globalement les commandes durant ces tests.
- `npm run register-commands`, `npm start` ; vérifier « Bot connected to Discord ». Les transports HTTP et WebSocket utilisent le proxy hérité lorsque présent, avec vérification TLS conservée.
- Effectuer la recette humaine et le build IA final décrits dans `docs/audit/v1-final-review.md` avant livraison au premier client. Les tests safe et le smoke API ne suffisent pas à déclarer la V1 commercialement validée.
- Sur un client : licence manuelle, `/panel`, paramètres personnalisés, tests d'accès avec un membre ordinaire et un staff, puis livraison. Tester expiration/réactivation sans effacer les données.
- Déploiement non effectué par la finalisation ; aucun achat d'hébergement, modèle ou crédit API.
