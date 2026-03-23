import type { Schema, Struct } from '@strapi/strapi';

export interface RecipeElementsIngredients extends Struct.ComponentSchema {
  collectionName: 'components_recipe_elements_ingredients';
  info: {
    displayName: 'ingredients';
  };
  attributes: {
    name: Schema.Attribute.String;
    note: Schema.Attribute.String;
    quantity: Schema.Attribute.String;
    unit: Schema.Attribute.String;
  };
}

export interface RecipeElementsInstructionStep extends Struct.ComponentSchema {
  collectionName: 'components_recipe_elements_instruction_steps';
  info: {
    displayName: 'instruction_step';
    icon: 'layer';
  };
  attributes: {
    description: Schema.Attribute.Text;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'recipe-elements.ingredients': RecipeElementsIngredients;
      'recipe-elements.instruction-step': RecipeElementsInstructionStep;
    }
  }
}
