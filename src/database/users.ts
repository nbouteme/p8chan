import { Admins } from "../main";
import { hashPassword, makeSalt } from "../utils";
import { Mongol } from "./posts";
import { User } from "./schema";

export let getUserByName = async (name: string) => {
    return await Admins.findOne({ ident: name }) as Mongol<User>;
};

export let noAdmin = async () => {
    let c = await Admins.countDocuments();
    return c == 0;
}

export let createUser = async (name: string, pass: string, role: string) => {
    if (await Admins.findOne({ ident: name }))
        throw "User already exists";

    let salt = makeSalt(32);
    await Admins.insertOne({
        ident: name, password: hashPassword(pass, salt), salt, role
    })
}