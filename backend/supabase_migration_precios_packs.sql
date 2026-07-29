-- Ejecutar en el SQL Editor de Supabase (Project > SQL Editor)
--
-- Los precios en `packs` eran de prueba (CrossFit incluso estaba en $0).
-- Esto es un UPDATE de datos, no un cambio de schema -- lo que la PWA
-- muestra en "Elegí tu pack" sale de esta tabla en tiempo real, así que no
-- hace falta ningún cambio de código, solo corregir los valores acá.

update packs set price = 30000 where name = 'Pack 12 clases CrossFit';
update packs set price = 18000 where name = 'Pack 8 clases Boxeo';
update packs set price = 22000 where name = 'Pack 12 clases Kickboxing';
update packs set price = 21000 where name = 'Mes libre Aparatos';

-- Verificación:
--   select name, price from packs order by name;
