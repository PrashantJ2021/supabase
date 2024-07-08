import { join } from 'node:path'

import { cache_fullProcess_withDevCacheBust } from '~/features/helpers.fs'
import { SPEC_DIRECTORY } from 'lib/docs'
import _typeSpec from '~/spec/enrichments/tsdoc_v2/combined.json' assert { type: 'json' }

const typeSpec = _typeSpec as any

const ANONYMOUS = '[ANONYMOUS]'

interface ModuleTypes {
  name: string
  methods: Map<string, MethodTypes>
  types: Map<string, CustomType>
}

interface MethodTypes {
  name: string
  comment?: Comment
  params: Array<ParamType>
  ret: ReturnType
}

interface Comment {
  shortText?: string
  text?: string
}

interface ParamType {
  name: string
  comment?: Comment
  isOptional?: boolean
  type: Type | undefined
}

interface ReturnType {
  type: Type | undefined
}

interface PropertyType {
  name: string
  comment?: Comment
  isOptional?: boolean
  type: Type | undefined
}

type Type = IntrinsicType | CustomType

interface IntrinsicType {
  type: 'intrinsic'
  name: string
  comment?: Comment
}

type CustomType = CustomObjectType | CustomUnionType

interface CustomObjectType {
  type: 'customObject'
  name: string
  comment?: Comment
  properties: Array<PropertyType>
}

interface CustomUnionType {
  type: 'customUnion'
  comment?: Comment
  name: string
}

function _parseTypeSpec() {
  const modules = (typeSpec.children ?? []).map(parseMod)
  console.log(JSON.stringify(Object.fromEntries(modules[0].methods.entries()), null, 2))
  return modules as Array<ModuleTypes>
}

function parseMod(mod: (typeof typeSpec)['children'][number]) {
  const res: ModuleTypes = {
    name: mod.name,
    methods: new Map(),
    types: new Map(),
  }

  const targetMap = new Map<number, any>()
  buildMap(mod, targetMap)

  parseModInternal(mod, targetMap, [], res)

  return res
}

function buildMap(node: any, map: Map<number, any>) {
  if ('id' in node) {
    map.set(node.id, node)
  }
  if ('children' in node) {
    node.children.forEach((child: any) => buildMap(child, map))
  }
}

function parseModInternal(
  node: any,
  map: Map<number, any>,
  currentPath: Array<string>,
  res: ModuleTypes
) {
  let updatedPath: Array<string>

  switch (node.kindString) {
    case 'Module':
      updatedPath = [...currentPath, node.name]
      node.children?.forEach((child: any) => parseModInternal(child, map, updatedPath, res))
      return
    case 'Reference':
      return
    case 'Class':
      updatedPath = [...currentPath, node.name]
      node.children?.forEach((child: any) => parseModInternal(child, map, updatedPath, res))
      return
    case 'Constructor':
      parseConstructor(node, map, currentPath, res)
    case 'Project':
    case undefined:
      updatedPath = [...currentPath, node.name]
      node.children?.forEach((child: any) => parseModInternal(child, map, updatedPath, res))
    default:
      return undefined
  }
}

function parseConstructor(
  node: any,
  map: Map<number, any>,
  currentPath: Array<string>,
  res: ModuleTypes
) {
  const $ref = `${currentPath.join('.')}.constructor`

  const signature = node.signatures[0]
  if (!signature) return

  const params: Array<ParamType> = (signature.parameters ?? []).map((param: any) => {
    const type = parseType(param.type, map)

    const res: ParamType = {
      name: param.name,
      type,
    }

    if (param.flags?.isOptional) {
      res.isOptional = true
    }

    if (param.comment) {
      res.comment = param.comment
    }

    return res
  })

  const types: MethodTypes = {
    name: $ref,
    params,
    ret: undefined,
  }

  if (signature.comment) {
    types.comment = signature.comment
  }

  res.methods.set($ref, types)
}

function parseType(type: any, map: Map<number, any>) {
  switch (type.type) {
    case 'intrinsic':
      return type
    case 'reference':
      return parseReferenceType(type, map)
    case 'reflection':
      return parseReflectionType(type, map)
    case 'indexedAccess':
      return parseIndexedAccessType(type, map)
    default:
      return undefined
  }
}

function parseReferenceType(type: any, map: Map<number, any>) {
  if (!type.dereferenced?.type) return undefined

  const dereferencedType = parseType(type.dereferenced.type, map)
  if (dereferencedType) {
    dereferencedType.name = type.name
  }

  if (type.comment) {
    dereferencedType.comment = {
      ...dereferencedType.comment,
      ...type.comment,
    }
  }

  return dereferencedType
}

function parseReflectionType(type: any, map: Map<number, any>) {
  if (!type.declaration) return undefined

  let res: Type
  switch (type.declaration.kindString) {
    case 'Type literal':
      res = parseTypeLiteral(type, map)
      break
    default:
      break
  }

  return res
}

function parseTypeLiteral(type: any, map: Map<number, any>) {
  const name = type.declaration?.name || ANONYMOUS
  const properties = (type.declaration?.children ?? []).map((child: any) =>
    parseTypeLiteralInternals(child, map)
  )
  return {
    name,
    type: 'customObject',
    properties,
  } satisfies CustomObjectType
}

function parseTypeLiteralInternals(elem: any, map: Map<number, any>) {
  switch (elem.kindString) {
    case 'Property':
      return parseTypeLiteralProperty(elem, map)
    default:
      return undefined
  }
}

function parseTypeLiteralProperty(elem: any, map: Map<number, any>) {
  const name = elem.name || ANONYMOUS
  const type = parseType(elem.type, map)

  const res = {
    name,
    type,
  } as PropertyType

  if (elem.flags?.isOptional) {
    res.isOptional = true
  }

  if (elem.comment) {
    res.comment = elem.comment
  }

  return res
}

function parseIndexedAccessType(type: any, map: Map<number, any>) {
  switch (type.objectType.type) {
    case 'reference':
      return parseIndexedAccessReference(type, map)
    default:
      // Not implemented
      return undefined
  }
}

function parseIndexedAccessReference(type: any, map: Map<number, any>) {
  const deref = map.get(type.objectType.id)
  if (!deref) return undefined

  switch (deref.kindString) {
    case 'Interface':
      if (type.indexType.type === 'literal') {
        return `${type.objectType.name}['${type.indexType.value}']`
      }
    // Fall through
    default:
      return undefined
  }
}

const parseTypeSpec = cache_fullProcess_withDevCacheBust(
  _parseTypeSpec,
  join(SPEC_DIRECTORY, 'enrichments/tsdoc_v2/combined.json'),
  (filename) => JSON.stringify([])
)

async function getTypeSpec(ref: string) {
  await parseTypeSpec()
}

export { getTypeSpec }
