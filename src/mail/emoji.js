// The emoji offered by the editor's emoji picker, by category. Each line is
// "emoji english words | mots français", so searching works in both languages.
// Loaded only when the picker is first opened (see EmojiPicker.jsx).
// Flags are left out: Windows doesn't draw them, it shows two letters instead.
// So are emoji newer than Unicode 12.1, which Windows 10 shows as empty boxes.

const RAW = {
  smileys: `
😀 grinning smile happy | sourire content joyeux
😃 smiley big smile happy | grand sourire content
😄 smile laugh happy | sourire rire content
😁 grin beaming | sourire radieux
😆 laughing squint | rire éclat
😅 sweat smile relief phew | soulagement ouf sueur
😂 joy tears laughing lol | larmes de rire mdr
🤣 rofl rolling laughing | mort de rire mdr
🙂 slight smile | léger sourire
🙃 upside down silly | à l'envers
😉 wink | clin d'oeil
😊 blush smiling eyes happy | sourire timide content
😇 innocent halo angel | innocent ange auréole
🥰 love hearts adore | amoureux coeurs adorer
😍 heart eyes love | yeux en coeur amoureux
🤩 star struck wow | ébloui étoiles
😘 kiss blowing | bisou baiser
😗 kissing | bisou
😚 kissing closed eyes | bisou
😋 yum delicious tongue | miam délicieux
😛 tongue | langue
😜 wink tongue crazy | langue clin d'oeil
🤪 zany crazy | loufoque fou
😝 squint tongue | langue grimace
🤑 money mouth rich | argent riche
🤗 hug hugging | câlin embrasser
🤭 hand over mouth oops giggle | oups gloussement
🤫 shush quiet secret | chut silence secret
🤔 thinking hmm | réfléchir pensif hmm
🤐 zipper mouth secret | bouche cousue secret
🤨 raised eyebrow suspicious | sourcil levé méfiant
😐 neutral | neutre
😑 expressionless | sans expression
😶 no mouth speechless | sans voix muet
😏 smirk | narquois sourire en coin
😒 unamused | blasé pas amusé
🙄 eye roll | lever les yeux au ciel
😬 grimace awkward | grimace gêne
🤥 lying pinocchio | mensonge menteur
😌 relieved calm | soulagé calme
😔 pensive sad | pensif triste
😪 sleepy | somnolent
🤤 drooling | bave
😴 sleeping zzz | dormir sommeil
😷 mask sick | masque malade
🤒 thermometer fever ill | fièvre malade
🤕 bandage hurt | blessé pansement
🤢 nauseated sick | nausée
🤮 vomit | vomir
🤧 sneeze cold | éternuer rhume
🥵 hot heat | chaud chaleur
🥶 cold freezing | froid gelé
🥴 woozy dizzy | étourdi pompette
😵 dizzy | étourdi
🤯 mind blown exploding | époustouflé tête qui explose
🤠 cowboy | cowboy
🥳 party celebration birthday | fête anniversaire célébration
😎 cool sunglasses | cool lunettes de soleil
🤓 nerd geek | intello
🧐 monocle curious | monocle curieux
😕 confused | confus perplexe
😟 worried | inquiet
🙁 frown | moue mécontent
😮 open mouth surprised | surpris bouche ouverte
😯 hushed | étonné
😲 astonished shocked | stupéfait choqué
😳 flushed embarrassed | rougir gêné
🥺 pleading puppy eyes | suppliant
😦 frowning open mouth | consterné
😧 anguished | angoissé
😨 fearful scared | effrayé peur
😰 anxious sweat | anxieux
😥 sad relieved | déçu soulagé
😢 cry tear sad | pleurer larme triste
😭 sob crying loudly | sanglot pleurer
😱 scream fear | hurler peur cri
😖 confounded | désemparé
😣 persevering | persévérant
😞 disappointed | déçu
😓 downcast sweat | abattu
😩 weary | las épuisé
😫 tired | fatigué
🥱 yawn bored | bâiller ennui
😤 triumph huff | fier rage contenue
😡 pouting angry red | furieux en colère
😠 angry | en colère fâché
🤬 cursing swearing | jurons insulte
😈 devil smiling | diable coquin
👿 imp angry devil | diablotin
💀 skull dead | crâne mort
☠️ skull crossbones | tête de mort
💩 poop | caca
🤡 clown | clown
👻 ghost | fantôme
👽 alien | extraterrestre
🤖 robot | robot
😺 cat smile | chat sourire
😻 cat heart eyes | chat amoureux
🙈 see no evil monkey | singe ne rien voir
🙉 hear no evil monkey | singe ne rien entendre
🙊 speak no evil monkey | singe ne rien dire
`,
  people: `
👋 wave hello bye | salut coucou au revoir
🤚 raised back of hand | main levée
✋ raised hand stop high five | main levée stop
🖐️ hand fingers splayed | main doigts écartés
🖖 vulcan salute | salut vulcain
👌 ok perfect | ok parfait
🤏 pinching small | petit pincer
✌️ victory peace | victoire paix
🤞 crossed fingers luck | doigts croisés chance
🤟 love you gesture | je t'aime
🤘 rock horns | rock cornes
🤙 call me shaka | appelle moi
👈 point left | gauche montrer
👉 point right | droite montrer
👆 point up | haut montrer
👇 point down | bas montrer
☝️ index up one | index levé un
👍 thumbs up yes like good | pouce oui d'accord bien
👎 thumbs down no dislike | pouce bas non
✊ raised fist | poing levé
👊 fist bump punch | coup de poing check
🤛 left fist | poing gauche
🤜 right fist | poing droit
👏 clap applause bravo | applaudir bravo
🙌 raising hands hooray | hourra bravo
👐 open hands | mains ouvertes
🤲 palms up | paumes
🤝 handshake deal agreement | poignée de main accord
🙏 pray please thanks folded hands | merci s'il vous plaît prière
✍️ writing hand | écrire
💅 nail polish | vernis
🤳 selfie | selfie
💪 muscle strong flex | muscle fort
🧠 brain smart | cerveau intelligent
👀 eyes look | yeux regarder
👁️ eye | oeil
👄 mouth lips | bouche lèvres
🗣️ speaking head | parler
👶 baby | bébé
🧒 child | enfant
👦 boy | garçon
👧 girl | fille
🧑 person adult | personne adulte
👨 man | homme
👩 woman | femme
🧓 older person | personne âgée
👴 old man grandfather | grand-père vieil homme
👵 old woman grandmother | grand-mère vieille femme
🧑‍💻 technologist coder computer | informaticien ordinateur
🧑‍🏫 teacher | enseignant professeur
🧑‍⚖️ judge law | juge justice
🧑‍⚕️ health worker doctor | médecin soignant
🧑‍🍳 cook chef | cuisinier chef
🧑‍🎨 artist painter | artiste peintre
🧑‍🔬 scientist | scientifique
👮 police officer | policier
💁 tipping hand information | information
🙋 raising hand | lever la main
🤷 shrug dunno | haussement d'épaules sais pas
🤦 facepalm | consternation main sur le visage
🙇 bow sorry | courbette excuses
🧘 yoga meditation | yoga méditation
🏃 running | courir
🚶 walking | marcher
💃 dancing woman | danser danseuse
🕺 dancing man | danser danseur
👪 family | famille
💑 couple heart | couple amoureux
`,
  hearts: `
❤️ red heart love | coeur rouge amour
🧡 orange heart | coeur orange
💛 yellow heart | coeur jaune
💚 green heart | coeur vert
💙 blue heart | coeur bleu
💜 purple heart | coeur violet
🖤 black heart | coeur noir
🤍 white heart | coeur blanc
🤎 brown heart | coeur marron
💔 broken heart | coeur brisé
❣️ heart exclamation | coeur exclamation
💕 two hearts | deux coeurs
💞 revolving hearts | coeurs tournants
💓 beating heart | coeur battant
💗 growing heart | coeur grandissant
💖 sparkling heart | coeur étincelant
💘 heart arrow cupid | coeur flèche cupidon
💝 heart ribbon gift | coeur cadeau
💌 love letter | lettre d'amour
💋 kiss mark | bisou trace
💯 hundred perfect | cent parfait
💢 anger | colère
💥 collision boom | boum explosion
💫 dizzy stars | étoiles
💦 sweat droplets | gouttes
💨 dash fast | vite fumée
💬 speech bubble comment | bulle commentaire
💭 thought bubble | pensée bulle
💤 zzz sleep | dodo sommeil
✅ check done yes | coché fait validé oui
☑️ check box | case cochée
✔️ check mark | coche
❌ cross no wrong | croix non faux
❎ cross button | croix
➕ plus add | plus ajouter
➖ minus | moins
➗ divide | diviser
✖️ multiply | multiplier
❓ question | question
❔ white question | question
❗ exclamation | exclamation
‼️ double exclamation | double exclamation
⁉️ exclamation question | exclamation question
⚠️ warning caution | attention avertissement
🚫 prohibited no | interdit
⛔ no entry | sens interdit
🔴 red circle | rond rouge
🟠 orange circle | rond orange
🟡 yellow circle | rond jaune
🟢 green circle | rond vert
🔵 blue circle | rond bleu
🟣 purple circle | rond violet
⚫ black circle | rond noir
⚪ white circle | rond blanc
⭐ star | étoile
🌟 glowing star | étoile brillante
✨ sparkles | étincelles
⚡ lightning | éclair
🔥 fire hot lit | feu flamme
♻️ recycle | recycler
©️ copyright | copyright
®️ registered | marque déposée
™️ trademark | marque
🆗 ok button | ok
🆕 new | nouveau
🆓 free | gratuit
🔝 top | top
🔜 soon | bientôt
➡️ right arrow | flèche droite
⬅️ left arrow | flèche gauche
⬆️ up arrow | flèche haut
⬇️ down arrow | flèche bas
↩️ return back | retour
🔁 repeat | répéter
🔒 locked secure | verrouillé sécurisé cadenas
🔓 unlocked | déverrouillé
🔑 key | clé
🔐 locked key | cadenas clé
♾️ infinity | infini
`,
  nature: `
🐶 dog puppy | chien chiot
🐱 cat kitten | chat chaton
🐭 mouse | souris
🐹 hamster | hamster
🐰 rabbit bunny | lapin
🦊 fox | renard
🐻 bear | ours
🐼 panda | panda
🐨 koala | koala
🐯 tiger | tigre
🦁 lion | lion
🐮 cow | vache
🐷 pig | cochon
🐸 frog | grenouille
🐵 monkey | singe
🐔 chicken | poule
🐧 penguin | pingouin manchot
🐦 bird | oiseau
🦆 duck | canard
🦅 eagle | aigle
🦉 owl | hibou chouette
🐴 horse | cheval
🦄 unicorn | licorne
🐝 bee | abeille
🦋 butterfly | papillon
🐌 snail | escargot
🐞 ladybug | coccinelle
🐢 turtle | tortue
🐍 snake | serpent
🐙 octopus | pieuvre
🐬 dolphin | dauphin
🐳 whale | baleine
🐟 fish | poisson
🦈 shark | requin
🐘 elephant | éléphant
🦒 giraffe | girafe
🐑 sheep | mouton
🐐 goat | chèvre
🐈 cat | chat
🐕 dog | chien
🐾 paw prints | pattes empreintes
🌸 cherry blossom flower | fleur cerisier
🌹 rose | rose
🌻 sunflower | tournesol
🌷 tulip | tulipe
🌼 blossom | fleur
💐 bouquet flowers | bouquet fleurs
🌱 seedling plant | pousse plante semis
🌿 herb | herbe aromatique
🍀 four leaf clover luck | trèfle chance
🍁 maple leaf | feuille d'érable
🍂 fallen leaves autumn | feuilles mortes automne
🌳 tree | arbre
🌲 evergreen tree | sapin
🌴 palm tree | palmier
🌵 cactus | cactus
🍄 mushroom | champignon
🌍 earth globe world europe africa | terre monde europe
🌎 earth globe americas | terre monde amérique
🌙 moon night | lune nuit
☀️ sun sunny | soleil
🌤️ sun cloud | soleil nuage
⛅ partly cloudy | nuageux
☁️ cloud | nuage
🌧️ rain | pluie
⛈️ storm thunder | orage
❄️ snowflake | flocon neige
☃️ snowman | bonhomme de neige
🌈 rainbow | arc-en-ciel
☔ umbrella rain | parapluie
🌊 wave sea ocean | vague mer océan
💧 droplet water | goutte eau
`,
  food: `
🍎 apple red | pomme
🍐 pear | poire
🍊 orange tangerine | orange mandarine
🍋 lemon | citron
🍌 banana | banane
🍉 watermelon | pastèque
🍇 grapes | raisin
🍓 strawberry | fraise
🍒 cherries | cerises
🍑 peach | pêche
🥭 mango | mangue
🍍 pineapple | ananas
🥥 coconut | noix de coco
🥝 kiwi | kiwi
🍅 tomato | tomate
🍆 eggplant aubergine | aubergine
🥑 avocado | avocat
🥦 broccoli | brocoli
🥕 carrot | carotte
🌽 corn | maïs
🌶️ hot pepper chili | piment
🧄 garlic | ail
🧅 onion | oignon
🥔 potato | pomme de terre
🥐 croissant | croissant
🥖 baguette bread | baguette pain
🍞 bread | pain
🧀 cheese | fromage
🥚 egg | oeuf
🍳 cooking fried egg | cuisine oeuf au plat
🥞 pancakes | crêpes
🥓 bacon | bacon lard
🍗 chicken leg | cuisse de poulet
🍔 burger | hamburger
🍟 fries | frites
🍕 pizza | pizza
🌭 hot dog | hot-dog
🥪 sandwich | sandwich
🌮 taco | taco
🥗 salad | salade
🍝 spaghetti pasta | pâtes spaghetti
🍜 noodles ramen | nouilles
🍣 sushi | sushi
🍤 shrimp | crevette
🍦 ice cream | glace
🍰 cake | gâteau
🎂 birthday cake | gâteau d'anniversaire
🧁 cupcake | cupcake
🍫 chocolate | chocolat
🍬 candy | bonbon
🍪 cookie | biscuit cookie
🍯 honey | miel
☕ coffee tea hot | café thé
🍵 tea | thé
🥛 milk | lait
🍷 wine | vin
🍾 champagne bottle | champagne
🥂 cheers toast | santé trinquer
🍺 beer | bière
🍻 beers cheers | bières santé
🍸 cocktail | cocktail
🧃 juice | jus
🍽️ plate fork knife dinner | assiette repas dîner
`,
  activities: `
⚽ soccer football | football foot
🏀 basketball | basket
🏈 american football | football américain
⚾ baseball | baseball
🎾 tennis | tennis
🏐 volleyball | volley
🏉 rugby | rugby
🎱 pool billiards | billard
🏓 ping pong | ping-pong
🏸 badminton | badminton
⛳ golf | golf
🎿 ski | ski
🚴 cycling bike | vélo cyclisme
🏊 swimming | natation nager
🏆 trophy win | trophée victoire
🥇 gold medal first | médaille d'or premier
🥈 silver medal | médaille d'argent
🥉 bronze medal | médaille de bronze
🎯 target bullseye | cible dans le mille
🎲 dice game | dé jeu
♟️ chess | échecs
🧩 puzzle | puzzle
🎮 video game | jeu vidéo
🃏 joker card | joker carte
🎨 art palette painting | art palette peinture
🎭 theatre | théâtre
🎬 clapper film | cinéma film
🎤 microphone sing | micro chanter
🎧 headphones | casque
🎵 music note | note de musique
🎶 notes music | musique notes
🎹 piano | piano
🎸 guitar | guitare
🎻 violin | violon
🥁 drum | tambour batterie
🎉 party popper celebration congratulations | fête félicitations
🎊 confetti | confettis
🎈 balloon | ballon
🎁 gift present | cadeau
🎀 ribbon | ruban
🎄 christmas tree | sapin de noël
🎃 pumpkin halloween | citrouille halloween
🎆 fireworks | feux d'artifice
🕯️ candle | bougie
`,
  travel: `
🚗 car | voiture
🚕 taxi | taxi
🚌 bus | bus
🚑 ambulance | ambulance
🚒 fire engine | pompiers
🚓 police car | voiture de police
🚚 truck delivery | camion livraison
🚜 tractor | tracteur
🏍️ motorcycle | moto
🚲 bicycle | vélo
🛴 scooter | trottinette
🚆 train | train
🚄 high speed train tgv | tgv train à grande vitesse
🚇 metro | métro
✈️ airplane flight | avion vol
🛫 departure | départ
🛬 arrival | arrivée
🚀 rocket launch | fusée lancement
🚁 helicopter | hélicoptère
⛵ sailboat | voilier
🚢 ship | bateau paquebot
⚓ anchor | ancre
⛽ fuel | essence carburant
🚦 traffic light | feu tricolore
🗺️ map | carte
🧭 compass | boussole
🏔️ mountain snow | montagne
⛰️ mountain | montagne
🏖️ beach | plage
🏝️ island | île
🏕️ camping | camping
🏠 house home | maison
🏡 house garden | maison jardin
🏢 office building | bureau immeuble
🏥 hospital | hôpital
🏦 bank | banque
🏨 hotel | hôtel
🏫 school | école
🏛️ classical building | bâtiment classique
⛪ church | église
🏰 castle | château
🗼 tower | tour
🗽 statue of liberty | statue de la liberté
🌉 bridge night | pont
🌅 sunrise | lever de soleil
🌇 sunset city | coucher de soleil
🌃 night city | nuit ville
🧳 luggage suitcase | valise bagage
`,
  objects: `
📧 email e-mail | e-mail courriel
✉️ envelope letter mail | enveloppe lettre courrier
📩 envelope arrow incoming | enveloppe reçue
📨 incoming envelope | courrier reçu
📤 outbox sent | boîte d'envoi envoyé
📥 inbox | boîte de réception
📬 mailbox | boîte aux lettres
📮 postbox | boîte postale
📝 memo note write | note mémo écrire
✏️ pencil | crayon
🖊️ pen | stylo
📎 paperclip attachment | trombone pièce jointe
📌 pin | punaise épingle
📍 location pin | lieu position
✂️ scissors | ciseaux
📁 folder | dossier
📂 open folder | dossier ouvert
📄 document page | document page
📃 page curl | page
📑 bookmark tabs | onglets
📊 bar chart | graphique
📈 chart up increase | hausse graphique
📉 chart down decrease | baisse graphique
📋 clipboard | presse-papiers
📅 calendar date | calendrier date
📆 calendar | agenda calendrier
🗓️ spiral calendar | calendrier
⏰ alarm clock | réveil
⏳ hourglass waiting | sablier attente
⌛ hourglass done | sablier
🕐 one oclock time | une heure
⌚ watch | montre
📱 mobile phone | téléphone portable
☎️ telephone | téléphone
📞 phone receiver call | appel combiné
💻 laptop computer | ordinateur portable
🖥️ desktop computer | ordinateur
⌨️ keyboard | clavier
🖨️ printer | imprimante
💾 floppy save | disquette sauvegarder
💿 disc | disque cd
📷 camera photo | appareil photo
🎥 movie camera | caméra
📺 television tv | télévision
📻 radio | radio
🔋 battery | batterie pile
🔌 plug | prise
💡 light bulb idea | ampoule idée
🔦 flashlight | lampe torche
📚 books | livres
📖 open book read | livre ouvert lire
📰 newspaper | journal
🔖 bookmark | marque-page
🏷️ label tag | étiquette
💰 money bag | sac d'argent
💶 euro banknote | billet euro
💵 dollar banknote | billet dollar
💳 credit card | carte bancaire
🧾 receipt | reçu ticket
⚖️ scales justice balance law | balance justice droit
🔨 hammer | marteau
🛠️ tools | outils
🔧 wrench | clé à molette
⚙️ gear settings | engrenage réglages
🧲 magnet | aimant
🔬 microscope | microscope
🔭 telescope | télescope
📡 satellite antenna | antenne satellite
💉 syringe | seringue
💊 pill | pilule
🧹 broom | balai
🧺 basket | panier
🛒 shopping cart | caddie courses
🎓 graduation cap | diplôme
👓 glasses | lunettes
👔 tie shirt | cravate chemise
👗 dress | robe
👟 shoe sneaker | chaussure basket
🎩 top hat | chapeau haut-de-forme
💍 ring | bague
💎 gem diamond | diamant
🔔 bell notification | cloche notification
🔕 bell off mute | sourdine
📢 loudspeaker announcement | annonce haut-parleur
📣 megaphone | mégaphone
🔍 search magnifying glass | loupe recherche
🔗 link chain | lien chaîne
🧮 abacus math | boulier calcul
📐 triangle ruler geometry | équerre géométrie
`,
};

export const CATEGORIES = [
  { id: 'smileys', icon: '😀' },
  { id: 'people', icon: '👋' },
  { id: 'hearts', icon: '❤️' },
  { id: 'nature', icon: '🌿' },
  { id: 'food', icon: '🍎' },
  { id: 'activities', icon: '🎉' },
  { id: 'travel', icon: '✈️' },
  { id: 'objects', icon: '💡' },
];

// Searching ignores accents, so "coeur" finds "cœur" and "eclair" finds "éclair".
export const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/œ/g, 'oe').toLowerCase();

export const EMOJI = Object.fromEntries(Object.entries(RAW).map(([cat, text]) => [cat,
  text.trim().split('\n').map((line) => {
    const sp = line.indexOf(' ');
    const [en, fr = ''] = line.slice(sp + 1).split('|').map((x) => x.trim());
    return { e: line.slice(0, sp), en, fr, words: fold(`${en} ${fr}`) };
  })]));

export const ALL = Object.values(EMOJI).flat();

// Every word of the query must start a word of the emoji's keywords.
export function searchEmoji(query) {
  const q = fold(query).split(/\s+/).filter(Boolean);
  if (!q.length) return [];
  return ALL.filter((x) => {
    const w = x.words.split(/[\s'-]+/);
    return q.every((p) => w.some((k) => k.startsWith(p)));
  });
}
