# Installer ChiaraMail (version de test)

ChiaraMail est une messagerie pour l'adresse e-mail que vous avez déjà. Cette
version de test n'est pas encore signée auprès de Microsoft ni d'Apple : votre
ordinateur affichera donc un avertissement la première fois. Il suffit de le
passer une fois, comme indiqué ci-dessous.

## Windows

1. Ouvrez le fichier **ChiaraMail-Setup-0.1.0.exe**.
2. Si Windows affiche « Windows a protégé votre ordinateur », cliquez sur
   **Informations complémentaires**, puis sur **Exécuter quand même**.
3. Suivez l'installation. ChiaraMail apparaît ensuite sur le Bureau et dans le menu Démarrer.

## Mac

1. Ouvrez le fichier **.dmg** correspondant à votre Mac : **arm64** pour un Mac
   récent (puce Apple M1, M2, M3, M4…), **x64** pour un Mac à processeur Intel.
   (Menu Apple → À propos de ce Mac → « Puce » ou « Processeur ».)
2. Faites glisser **ChiaraMail** dans le dossier **Applications**.
3. Ouvrez ChiaraMail. Si le Mac indique qu'il ne peut pas vérifier l'application,
   cliquez sur **Terminé**, puis allez dans **Réglages Système → Confidentialité
   et sécurité**, descendez jusqu'au message concernant ChiaraMail et cliquez sur
   **Ouvrir quand même**. Confirmez avec votre mot de passe.

## Première connexion

1. Saisissez votre adresse e-mail et son mot de passe, puis **Se connecter**.
   ChiaraMail trouve tout seul les serveurs de la plupart des fournisseurs
   (Orange, Free, SFR, La Poste, OVHcloud…).
2. S'il ne les trouve pas, ouvrez **Paramètres des serveurs** et saisissez ceux
   qu'indiquent les pages d'aide de votre fournisseur (serveur IMAP pour le
   courrier entrant, SMTP pour le courrier sortant).
3. Gmail, Yahoo et iCloud demandent un **mot de passe d'application**, à créer
   dans les paramètres de sécurité de votre compte, à la place du mot de passe habituel.

Votre mot de passe reste sur votre ordinateur. ChiaraMail se connecte ensuite
tout seul au serveur européen des messages ECS : un e-mail contenant un code
arrive dans votre boîte, ChiaraMail le lit et le supprime lui-même.

## Messages ECS

Dans **Nouveau message**, la case **Message ECS** est cochée par défaut : seule
l'enveloppe du message part par e-mail ; son texte et ses pièces jointes sont
chiffrés sur votre ordinateur et conservés en Europe. Vous pouvez ensuite le
corriger (**Modifier**), le retirer (**Retirer**) et voir qui l'a lu.
