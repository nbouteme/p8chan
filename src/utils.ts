import crypto = require('crypto');

import { settings } from "./settings";
import { JWT } from './apiv1';


export let makeSalt = (l: number) => crypto.randomBytes(l);

export let digest = (s: Buffer) => {
    let c = crypto.createHash('sha256');
    c.update(s);
    return c.digest();
}

export let makeJWT = <T>(payload: T) => {
    let obj2b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64')
    let b64h = obj2b64({ alg: "HS256", typ: "JWT" });
    let b64p = obj2b64(payload);

    const hmac = crypto.createHmac('sha256', settings.secret);
    hmac.update(`${b64h}.${b64p}`);
    let signature = hmac.digest('base64');
    return `${b64h}.${b64p}.${signature}` as JWT<T>;
};

export let checkJWT = <T>(token: JWT<T>) => {
    let [b64h, b64p, signature] = token.split('.');
    const hmac = crypto.createHmac('sha256', settings.secret);
    hmac.update(`${b64h}.${b64p}`);
    return hmac.digest('base64') == signature;
};

export let getJWTPayload = <T>(token: JWT<T>): T => {
    if (!checkJWT(token))
        throw new Error('Invalid Token');
    let [b64h, b64p, signature] = token.split('.');
    return JSON.parse(Buffer.from(b64p, 'base64').toString()) as T;
};

export let encrypt = (clear: Buffer, key: string) => {
    // osef de ne pas utiliser l'auth car ca fini dans un hmac au final
    let kb = Buffer.from(key, 'hex');
    let cipher = crypto.createCipheriv('aes-128-cbc', kb, kb);
    cipher.update(clear);
    return cipher.final();
}

export let decrypt = (cipher: Buffer, key: string) => {
    // osef de ne pas utiliser l'auth car ca fini dans un hmac au final
    let kb = Buffer.from(key, 'hex');
    let decipher = crypto.createDecipheriv('aes-128-cbc', kb, kb);
    decipher.update(cipher);
    return decipher.final();
}

export let hashPassword = (str: string, salt: Buffer) => {
    const hash = crypto.createHash('sha256');
    hash.update(Buffer.concat([Buffer.from(str), salt]));
    return hash.digest();
}
