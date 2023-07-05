'use strict';
// proccessing json files into decentralized schema
const fn = require('zerodep/node/fn');
// input must be directory pathResolve arguments
module.exports = (...dirPathResolveArgs) => {
    const files = require('zerodep/node/tree/json')(...dirPathResolveArgs);
    const schema = {};
    // recursively extract schemas by referencing the extraction point (this will generate new ids)
    const extractSchemas = () => {
        fn.assignDeepKeyParent(
            /^(\$id|id)$/,
            (target, parentKey, key) => {
                if (target.$schema && typeof target[key] === 'string') {
                    try {
                        const id = decodeURI(new URL(target[key].replace(/#$/, '')).href.replace(/\.json(\/|$)/g, '$1'));
                        return (schema[id] = target) && { [parentKey]: { $ref: id } };
                    } catch (error) {}
                }
            },
            files
        );
    };
    // recursively extract ids by referencing the extraction point (this will generate new ids)
    const extractIds = (base) => {
        fn.replaceDeepKeyParent(
            /^(\$id|id)$/,
            (target, parentKey, key) => {
                if (typeof target[key] === 'string' && !/^#/.test(target[key])) {
                    try {
                        const id = decodeURI(new URL(target[key], base).href.replace(/\.json(\/|$)/g, '$1'));
                        return (schema[id] = target) && { [parentKey]: { $ref: id } };
                    } catch (error) {}
                }
            },
            schema[base]
        );
    };
    // globalize and combine all reference types into $ref, dynamic references will be recognized by their _ prefix
    const globalizeReferences = (id) => {
        fn.assignDeepKey(
            /^(\$ref|\$recursiveRef|\$dynamicRef)$/,
            (ref, key) => {
                if (typeof ref === 'string') {
                    const dot = ref.indexOf('#') === 0 && (ref !== '#' || key !== '$ref') ? '.' : '';
                    const base = dot ? id + '/' : id;
                    const hash = (key !== '$ref' && /#([^\/]|$)/.test(ref)) || /#(\/\$defs|\/definitions|[^\/])/.test(ref) ? '/#' : '';
                    const _ = key === '$ref' ? '' : key === '$recursiveRef' ? '/_meta' : '/_';
                    return { $ref: decodeURI(new URL(dot + ref.replace(/#/, hash + _), base).href.replace(/([^:\/])\/+/g, '$1/').replace(/\.json(\/|$)/g, '$1')) };
                }
            },
            schema[id]
        );
    };
    // extract definitions and remove their extraction point (this will generate new ids)
    const extractDefinitions = (id) => {
        if (schema[id].definitions) Object.keys(schema[id].definitions).forEach((key) => (schema[decodeURI(new URL(`./#/definitions/${key}`, id + '/').href)] = schema[id].definitions[key]));
        if (schema[id].$defs) Object.keys(schema[id].$defs).forEach((key) => (schema[decodeURI(new URL(`./#/$defs/${key}`, id + '/').href)] = schema[id].$defs[key]));
        // remove extracted definitions
        fn.replaceDeepKey(/^(definitions|\$defs)$/, () => [], schema[id]);
    };
    // extract anchors by referencing the extraction point (this will generate new ids)
    const extractAnchors = (id) => {
        fn.parseDeepKey(
            /^(\$anchor|\$recursiveAnchor|\$dynamicAnchor)$/,
            (...keys) => {
                const anchor = fn.get(schema, id, ...keys);
                const ref = keys.slice(0, -1).length ? { $ref: decodeURI(new URL(keys.slice(0, -1).join('/'), id + '/').href) } : { $ref: id };
                if (typeof anchor === 'string' && String(keys.slice(-1)) === '$anchor') schema[decodeURI(new URL(`./#/${anchor}`, id + '/').href)] = ref;
                if (typeof anchor === 'string' && String(keys.slice(-1)) === '$dynamicAnchor') schema[decodeURI(new URL(`./#/_${anchor}`, id + '/').href)] = ref;
                if (anchor === true && String(keys.slice(-1)) === '$recursiveAnchor') schema[decodeURI(new URL(`./#/_meta`, id + '/').href)] = ref;
            },
            schema[id]
        );
    };
    // transform references that would trigger infinite loop into dynamic references
    const transformReferences = (id) => {
        fn.parseDeepKey(
            '$ref',
            (...keys) => {
                const ref = fn.get(schema, id, ...keys);
                if (typeof ref === 'string') {
                    if ([id, ...keys.slice(0, -1)].join('/').indexOf(ref) === 0 && [id, ...keys.slice(0, -1)].join('/').indexOf(ref + '/#') === -1 && ref.indexOf('#/$defs') === -1 && ref.indexOf('#/definitions') === -1) {
                        schema[ref + '/#/_meta'] = { $ref: ref };
                        fn.set(ref + '/#/_meta', schema, id, ...keys);
                    }
                }
            },
            schema[id]
        );
    };
    // transform dependencies into dependentRequired and dependentSchemas
    const transformDependencies = (id) => {
        fn.replaceDeepKey(
            'dependencies',
            (target) => {
                if (typeof target === 'object') {
                    if (Object.keys(target).every((key) => Array.isArray(target[key]))) return { dependentRequired: target };
                    else return { dependentSchemas: target };
                }
            },
            schema[id]
        );
    };
    // transform items and additionalItems into prefixItems and items
    const transformItems = (id) => {
        fn.replaceDeepKey('items', (value) => (Array.isArray(value) ? { prefixItems: value } : undefined), schema[id]);
        fn.replaceDeepKey('additionalItems', (value) => [{ items: value }], schema[id]);
    };
    // reset references in decentralized ids as global jsonPointer (conversion to absolute URL is trivial)
    const resetReferences = (id) => {
        fn.assignDeepKey(
            '$ref',
            (ref) => {
                if (typeof ref === 'string' && schema[ref]) return { $ref: fn.jsonPointer('#', ref) };
                if (typeof ref === 'string') {
                    let keys;
                    const key = Object.keys(schema)
                        .filter((id) => ref.indexOf(id) === 0)
                        .find((id) => (keys = fn.jsonPointerKeys(fn.relativeUriReference(ref.replaceAll('#', '_'), id.replaceAll('#', '_')))) && fn.get(schema, id, ...keys));
                    if (key) return { $ref: fn.jsonPointer('#', key, ...keys) };
                }
            },
            schema[id]
        );
        // remove transformed keywords and their definitions
        fn.replaceDeepKey(/^(id|\$id|\$schema|\$anchor|\$recursiveAnchor|\$dynamicAnchor|\$recursiveRef|\$dynamicRef)$/, () => [], schema[id]);
        // remove $comment keyword if not enabled in .env file
        if (process.env.buildComment === 'false') fn.replaceDeepKey('$comment', () => [], schema[id]);
        // disable $vocabulary support if not enabled in .env file
        if (process.env.buildVocabulary === 'false') fn.replaceDeepKey('$vocabulary', () => [], schema[id]);
    };
    // extract schemas as decentralized ids (base schemas)
    extractSchemas();
    // extract ids as decentralized ids (ids nested inside of schemas)
    Object.keys(schema).forEach((id) => extractIds(id));
    // globalize references
    Object.keys(schema).forEach((id) => globalizeReferences(id));
    // extract definitions as decentralized ids
    Object.keys(schema).forEach((id) => extractDefinitions(id));
    // extract anchors as decentralized ids
    Object.keys(schema).forEach((id) => extractAnchors(id));
    // transform references in decentralized ids
    Object.keys(schema).forEach((id) => transformReferences(id));
    // transform dependencies in decentralized ids
    Object.keys(schema).forEach((id) => transformDependencies(id));
    // transform items in decentralized ids
    Object.keys(schema).forEach((id) => transformItems(id));
    // reset references in decentralized ids
    Object.keys(schema).forEach((id) => resetReferences(id));
    // return decentralized schema for passed files
    return schema;
};
