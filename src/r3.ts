import * as ts from "typescript";
import path = require('path');
import fs = require('fs');
import { JWT, ChallengeAnswer } from "./apiv1";

// peut être mieux optimisé pour la latence avec un languageservice? Fait
// peut encore réduire la latence d'avantage en séparant les définitions de l'api de l'entrée testé, mais c'est déjà suffisamment rapide

let inf = 'input.ts';
let rootFileNames = [inf];

let input = '';
let base = '';
let updates = 0;
let filecache: { [k in string]: string | undefined } = {}

let types = ["node"];

let options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2017,
    module: ts.ModuleKind.CommonJS,
    types,
    lib: ["lib.es5.d.ts", "lib.dom.d.ts"],
};

const servicesHost: ts.LanguageServiceHost = {
    getScriptFileNames: () => rootFileNames,
    getScriptVersion: fileName =>
        fileName == inf ? updates.toString() : '',
    getScriptSnapshot: fileName => {
        let str: string;
        if (fileName == inf)
            str = input;
        else if (fs.existsSync(fileName)) {
            str = fs.readFileSync(fileName).toString();
        }
        else
            return undefined;
        return ts.ScriptSnapshot.fromString(str);
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => options,
    getDefaultLibFileName: options => ts.getDefaultLibFilePath(options),
    fileExists: path =>
        path == inf || ts.sys.fileExists(path),
    readFile: fn => {
        if (fn == inf)
            return fn;
        if (filecache[fn])
            return filecache[fn];
        return filecache[fn] = ts.sys.readFile(fn);
    },
    readDirectory: ts.sys.readDirectory
};

const services = ts.createLanguageService(servicesHost, ts.createDocumentRegistry());

let signalModification = () => {
    updates++;
    let diags = services
        .getCompilerOptionsDiagnostics()
        .concat(services.getSyntacticDiagnostics(inf))
        .concat(services.getSemanticDiagnostics(inf));
    return diags.length == 0;
}

let k: JWT<{for: number, a: string}> = '' as any;

// inlineSourceMap et inlineSources nécessaires, vivement deno pour eval du typescript
let getSourceCode = (fn: string) => {
    let str = fs.readFileSync(fn).toString().split('\n');
    let srcmap = str.find(l => l.startsWith('//# sourceMappingURL'));
    if (!srcmap)
        return undefined;
    let data = JSON.parse(Buffer.from(srcmap.split(',')[1], 'base64').toString());
    return fs.readFileSync(path.resolve(path.dirname(fn), data.sources[0])).toString();
}

export let addDefinitions = (fn: string) => base += getSourceCode(fn);
export let addTypes = (t: string[]) => types = [...types, ...t]

// Cela peut paraître overkill d'instancier un compilateur juste pour vérifier les types,
// mais le cout total est comparativement infime par rapport à tout ce qui sera effectué après la validation d'une requete
// Un autre inconvéniant est l'impossibilité de checker des types composites du genre Required<T>,
// Le compilateur le gère facilement mais extraire cette information de type à la compilation sans répétition
// est impossible actuellement sans plugin/extensions du langage pour transformer
// let checker = makeChecker<T>()
// let checked = checker<Required<U>>(obj) // pour U dans T
// en
// let checker = makeChecker<T>
// let checked = checker<U>('Required<U>', obj) as Required<U>
// qui est safe, mais qui viole le principe DRY
// Si c'était possible, je n'aurais pas à centraliser les définitions dans l'interface APIV1 non plus.

export function makeChecker<T>() { //                                      | Je les utiliserais un jour...|
    return function <U extends keyof T, B = T[U]>(typename: U, obj: {}, dec: string = '', post: string[] = []): obj is B {
        // safe car la représentation JSON d'un objet est garantie d'etre une seule et unique expression JS
        let t: string | number | symbol;
        if (dec == '')
            t = typename;
        else
            t = `${dec}<${typename}${post.join(', ')}>`;
        input = `${base}\nlet x: ${String(t)} = ${JSON.stringify(obj)}`;
        return signalModification();
    }
}
