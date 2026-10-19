import assert from 'node:assert/strict';
import {
  buildSchema,
  type GraphQLCompositeType,
  getNamedType,
  isCompositeType,
  isInterfaceType,
  isObjectType,
  Kind,
  parse,
  type SelectionSetNode,
  validate,
} from 'graphql';

const special = new Set(['hasAnyTag', 'hasTags', 'inAnyCollection', 'inCollections', 'metaobject', 'field']);
/** Shopify Function input field-cost policy over the official GraphQL parser and supplied pinned schema.
 * This calculates query cost; it does not claim the runner measures that cost. */
export function calculatedQueryCost(document: string, schemaSource: string): number {
  const schema = buildSchema(schemaSource),
    ast = parse(document),
    errors = validate(schema, ast);
  assert.equal(errors.length, 0, errors.map((error) => error.message).join('\n'));
  assert.equal(ast.definitions.length, 1, 'One query required');
  const definition = ast.definitions[0];
  assert(definition?.kind === Kind.OPERATION_DEFINITION && definition.operation === 'query');
  assert(['CartTransformRunInput', 'Input'].includes(definition.name?.value ?? ''), 'Pinned query operation required');
  assert.equal(definition.variableDefinitions?.length ?? 0, 0, 'Variable query cost needs qualification');
  assert.equal(definition.directives?.length ?? 0, 0, 'Directive cost needs qualification');
  function selection(set: SelectionSetNode, parent: GraphQLCompositeType): number {
    let cost = 0;
    for (const node of set.selections) {
      assert.equal(node.directives?.length ?? 0, 0, 'Directive cost needs qualification');
      if (node.kind === Kind.INLINE_FRAGMENT) {
        const named = node.typeCondition ? schema.getType(node.typeCondition.name.value) : parent;
        assert(named && (isObjectType(named) || isInterfaceType(named)), 'Unsupported inline fragment');
        cost += selection(node.selectionSet, named);
        continue;
      }
      assert(node.kind === Kind.FIELD, 'Fragment spread cost needs qualification');
      const name = node.name.value;
      assert(!special.has(name), 'field with special cost needs an explicit policy rule');
      if (name === '__typename') continue;
      assert(isObjectType(parent) || isInterfaceType(parent), 'Field parent requires qualification');
      const field = parent.getFields()[name];
      assert(field, 'Unknown schema field');
      const returned = getNamedType(field.type);
      if (returned.name === 'Metafield') {
        cost += 3;
        continue;
      }
      if (parent.name === 'Metafield') continue;
      if (node.selectionSet) {
        assert(isCompositeType(returned), 'Composite field requires qualification');
        cost += selection(node.selectionSet, returned);
      } else cost += 1;
    }
    return cost;
  }
  const query = schema.getQueryType();
  assert(query, 'Query root required');
  const cost = selection(definition.selectionSet, query);
  assert(cost <= 30, 'Function query cost exceeds 30');
  return cost;
}
