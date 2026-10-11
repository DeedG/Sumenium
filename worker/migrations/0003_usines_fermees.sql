-- Le premier tirage des usines est terminé : les choix sont fermés (le staff peut les rouvrir dans l'onglet Staff)
UPDATE settings SET value = '0' WHERE key = 'usines_ouvertes';
