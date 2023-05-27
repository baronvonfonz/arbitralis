# arbitralis

Helper SQL

```
select ri.ingredient_id, i.name, i2.name, i2.id
  from recipes_ingredients ri
  join items i
    on i.id = ri.ingredient_id
  join recipes r
    on r.id = ri.recipe_id
  join items i2
    on i2.id = r.crafted_id
order by 1 desc;
```

## In Progress:

- data model for item pricing

## TODO:

- gil/specialshop

https://raw.githubusercontent.com/xivapi/ffxiv-datamining/master/csv/SpecialShop.csv

- venture calcs

https://github.com/xivapi/ffxiv-datamining/blob/e55e6d71d43999157db5a5cca94e7d596fd7088d/csv/RetainerTaskNormal.csv#L784