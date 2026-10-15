-- Ce qu'il faut faire pour chaque projet communautaire (affiché au survol sur le site)
ALTER TABLE projets ADD COLUMN description TEXT NOT NULL DEFAULT '';
UPDATE projets SET description = 'Construire le bâtiment de la mairie au spawn.' WHERE nom = 'Mairie';
UPDATE projets SET description = 'Construire le tribunal au spawn.' WHERE nom = 'Tribunal';
UPDATE projets SET description = 'Construire un restaurant au spawn, sur un thème différent de ceux qui existent déjà.' WHERE nom = 'Restaurant';
UPDATE projets SET description = 'Construire le musée.' WHERE nom = 'Musée';
UPDATE projets SET description = 'Faire le hub du Nether autour du portail du spawn.' WHERE nom = 'Hub nether';
UPDATE projets SET description = 'Faire un couloir décoré, avec panneaux, reliant toutes les bases d''une direction (Nord, Sud, Est ou Ouest).' WHERE nom = 'Couloirs nether';
UPDATE projets SET description = 'Fournir de grosses quantités de ressources pour un projet ou une faction.' WHERE nom = 'Fourniture de ressources';
UPDATE projets SET description = 'Apporter son aide à une autre faction : build, terraformage…' WHERE nom = 'Aide à une autre faction';
UPDATE projets SET description = 'Ajouter un beacon full régénération au spawn, là où il n''y en a pas.' WHERE nom = 'Beacon full au spawn';
UPDATE projets SET description = 'Faire des routes entre les différents bâtiments du spawn.' WHERE nom = 'Routes du spawn';
UPDATE projets SET description = 'Éclairer le spawn : torches, lampadaires…' WHERE nom = 'Éclairage du spawn';
UPDATE projets SET description = 'Organiser un évènement pour le serveur.' WHERE nom = 'Organisation d''un évènement';
UPDATE projets SET description = 'Construire un bâtiment pour accueillir l''hôtel des ventes du mod, qui permet de mettre des objets aux enchères.' WHERE nom = 'Hôtel des ventes';
