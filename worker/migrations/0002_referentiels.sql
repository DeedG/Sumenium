-- Liste des usines (onglet « Projets Usine ») et prix d'échange du FISC
INSERT INTO usines (nom, taille, ordre) VALUES
 ('Usine à pigmen / Or','grosse',1),('Usine à fer','grosse',2),('Usine à raid','grosse',3),('Usine à guardian','grosse',4),
 ('Usine à shulker','grosse',5),('Usine à bibliothécaire','grosse',6),('Usine à mob','grosse',7),('Usine à wither skeleton','grosse',8),
 ('Usine blocs à gravité','grosse',9),('Usine à piglins / troc','grosse',10),
 ('Usine à witch','moyenne',11),('Usine à slime','moyenne',12),('Usine à bois','moyenne',13),('Usine à creeper','moyenne',14),
 ('Usine à drowned','moyenne',15),('Usine à abeille','moyenne',16),('Usine à mousse','moyenne',17),('Usine à Allay/Tatou pour xp','moyenne',18),
 ('Usine à grenouille','moyenne',19),
 ('Usine avec spawner','petite',20),('Usine à ghast','petite',21),('Usine à blaze','petite',22),('Usine à enderman','petite',23),
 ('Usine à potions','petite',24),('Usine à trial chamber','petite',25),('Usine à pillager','petite',26),('Usine à wither (wither rose + obsi)','petite',27),
 ('Usine à laine','petite',28),('Usine à Bonemeal','petite',29),('Ferme à bouffe hors moutons et abeilles','petite',30),('Usine à résine','petite',31),
 ('Usine à fleur','petite',32);

INSERT INTO prix (minerai, roche, prix, ordre) VALUES
 ('Charbon','Pierre (Stone)',1,1),('Charbon','Pierre des profondeurs (Deepslate)',80,2),
 ('Cuivre','Pierre (Stone)',1.5,3),('Cuivre','Pierre des profondeurs (Deepslate)',3.5,4),
 ('Fer','Pierre (Stone)',4,5),('Fer','Pierre des profondeurs (Deepslate)',6,6),
 ('Or','Pierre (Stone)',15,7),('Or','Pierre des profondeurs (Deepslate)',12,8),
 ('Redstone','Pierre (Stone)',4,9),('Redstone','Pierre des profondeurs (Deepslate)',2,10),
 ('Lapis-Lazuli','Pierre (Stone)',5,11),('Lapis-Lazuli','Pierre des profondeurs (Deepslate)',7,12),
 ('Émeraude','Pierre (Stone)',25,13),('Émeraude','Pierre des profondeurs (Deepslate)',90,14),
 ('Diamant','Pierre (Stone)',70,15),('Diamant','Pierre des profondeurs (Deepslate)',40,16),
 ('Ancien débris','Bloc',100,17);
