declare module "evernote" {
  export class Client {
    constructor(options: { token: string; sandbox?: boolean });
    getNoteStore(): NoteStore;
  }

  export namespace Types {
    class Note {
      guid?: string;
      title?: string;
      content?: string;
      notebookGuid?: string;
      tagGuids?: string[];
      created?: number;
      updated?: number;
    }
  }

  export class NoteStore {
    static NoteFilter: new (options?: { words?: string; notebookGuid?: string }) => any;
    static NotesMetadataResultSpec: new (options?: {
      includeTitle?: boolean;
      includeCreated?: boolean;
      includeUpdated?: boolean;
      includeNotebookGuid?: boolean;
      includeTagGuids?: boolean;
    }) => any;

    listNotebooks(): Promise<any[]>;
    findNotesMetadata(filter: any, offset: number, maxNotes: number, spec: any): Promise<any>;
    getNote(
      guid: string,
      withContent: boolean,
      withResourcesData: boolean,
      withResourcesRecognition: boolean,
      withResourcesAlternateData: boolean
    ): Promise<any>;
    createNote(note: Types.Note): Promise<any>;
    updateNote(note: Types.Note): Promise<any>;
  }

  const Evernote: {
    Client: typeof Client;
    Types: typeof Types;
    NoteStore: typeof NoteStore;
  };
  export default Evernote;
}
