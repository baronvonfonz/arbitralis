select i.id, i.ilvl, i.name, r.crafted_id, ri.ingredient_id, ri.name, ri.amount
  from items i
  join recipes r on r.crafted_id = i.id
  join (select t_ri.ingredient_id as ingredient_id, t_i.name as name, t_ri.recipe_id as recipe_id, t_ri.amount as amount
          from items t_i
		  join recipes_ingredients t_ri on t_i.id = t_ri.ingredient_id) ri 
	on r.id = ri.recipe_id
 where i.ilvl = 580;
		  
select t_ri.ingredient_id, t_i.name
          from items t_i
		  join recipes_ingredients t_ri on t_i.id = t_ri.ingredient_id;		  