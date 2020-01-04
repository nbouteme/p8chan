export type JWT<T> = string & { __jwt_tag?: T };

//export type RequiredProp<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>

/*
L'idée ici est d'avoir une API versionnée et de pouvoir définir des extensions d'api
en typescript, avec de l'extension d'interface
*/
export interface PostUploadWithoutFile {
    comment?: string;
    name?: string;
    subject?: string;
    email?: string;
    challenge: JWT<{ for: string, exp: number }>;
    file?: never;
}

export interface Identity {
    role?: string;
    expiration?: number;
};

export type PostUploadWithFile = Omit<PostUploadWithoutFile, 'file'> & { file: File };
export type PostUpload = PostUploadWithFile | PostUploadWithoutFile;

export interface Board {
    name: string;
    filesize_limit: number;
    worksafe: boolean;
    bump_limit: number;
    title: string;
}

export interface LoginForm {
    ident: string;
    pass: string;
};

export type Post = Omit<PostUploadWithoutFile, 'challenge'> & {
    id: number;
    trip?: string;
    fw?: number;
    fh?: number;
    fs?: number;
    fn?: string;
    date: number;
};

export type Thread = {
    sticky: number;
    last_bump: number;
    id: number;
}

export type BoardSetting = Omit<Board, 'threads'>;

export type Challenge = {
    cap: string;
    verif: JWT<{
        for: string;
        exp: number;
        ra: string;
    }>
}

export type ChallengeAnswer = {
    ans: string;
    token: Challenge['verif']
}

// Tout type déclaré dans cette interface est vérifiable automatiquement
// incidentellement, tout les types qui sont transmis par l'api sont déclaré ici
export interface ApiV1 {
    // Dans cet partie sont ce qui est envoyé par le client au serveur
    // Les types doivent avoir les mêmes noms que les clés pour que la vérification automatique fonctionne
    PostUpload: PostUpload;
    PostUploadWithoutFile: PostUploadWithoutFile;
    LoginForm: LoginForm;
    BoardSetting: BoardSetting;
    number: number;
    boolean: boolean;
    ChallengeAnswer: ChallengeAnswer;

    // Ici sont les types serveur->client, donc pas besoin de la contrainte au dessus
    Board: Board;
    Boards: Board[];
    Error: { reason: string };
    Success: { success: true };
    Threads: Thread[];
    Identity: string;
    Posts: Post[];
}
