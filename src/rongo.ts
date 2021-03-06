import {
  ChangeStreamOptions,
  ClientSession,
  CollectionCreateOptions,
  CommonOptions,
  Db,
  DbAddUserOptions,
  DbCollectionOptions,
  MongoClient,
  MongoClientOptions,
  ReadPreferenceOrMode
} from "mongodb";
import {
  buildGraph,
  Collection,
  Document,
  findDanglingKeys,
  Graph,
  ObjectID,
  Schema
} from ".";

// The Rongo class

export class Rongo {
  readonly client: Promise<MongoClient>;
  readonly handle: Promise<Db>;
  graph: Graph;
  isConnected: boolean;

  constructor(
    uri: string | Promise<string>,
    {
      schema,
      ...options
    }: MongoClientOptions & { schema?: Schema | string } = {}
  ) {
    this.client = Promise.resolve(uri).then(uri =>
      MongoClient.connect(uri, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        ...options
      })
    );
    this.handle = this.client.then(client => {
      const dbName = (client as any).s.options.dbName;
      if (!dbName)
        throw new Error("The connection uri must contain a database name");
      return client.db(dbName);
    });
    this.graph = Object.create(null);
    if (schema) this.schema(schema);
    this.isConnected = false;
    this.client.then(client => {
      this.isConnected = client.isConnected();
    });
  }

  // Client methods :

  active() {
    return this.client;
  }

  async close() {
    const client = await this.client;
    await client.close();
    this.isConnected = client.isConnected();
  }

  // Database methods :

  async addUser(
    username: string,
    password: string,
    options?: DbAddUserOptions
  ) {
    const db = await this.handle;
    return db.addUser(username, password, options);
  }

  findDanglingKeys(options?: { batchSize?: number; limit?: number }) {
    return findDanglingKeys(this, options);
  }

  collection<T extends Document>(name: string, options?: DbCollectionOptions) {
    return new Collection<T>(this, name, options);
  }

  async command(
    command: object,
    options?: { readPreference?: ReadPreferenceOrMode; session?: ClientSession }
  ) {
    const db = await this.handle;
    return db.command(command, options);
  }

  async createCollection<T extends Document>(
    name: string,
    options?: CollectionCreateOptions
  ) {
    const db = await this.handle;
    await db.createCollection(name, options);
    return this.collection<T>(name, options);
  }

  async drop() {
    const db = await this.handle;
    return db.dropDatabase();
  }

  async executeDbAdminCommand(
    command: object,
    options?: { readPreference?: ReadPreferenceOrMode; session?: ClientSession }
  ) {
    const db = await this.handle;
    return db.executeDbAdminCommand(command, options);
  }

  async listCollections(
    filter?: object,
    options?: {
      nameOnly?: boolean;
      batchSize?: number;
      readPreference?: ReadPreferenceOrMode;
      session?: ClientSession;
    }
  ) {
    const db = await this.handle;
    return db.listCollections(filter, options).toArray();
  }

  async removeUser(username: string, options?: CommonOptions) {
    const db = await this.handle;
    return db.removeUser(username, options);
  }

  schema(schema: Schema | string) {
    this.graph = buildGraph(schema);
  }

  async stats(options?: { scale?: number }) {
    const db = await this.handle;
    return db.stats(options);
  }

  async watch<T extends object = { _id: ObjectID }>(
    pipeline?: object[],
    options?: ChangeStreamOptions & { session?: ClientSession }
  ) {
    const db = await this.handle;
    return db.watch<T>(pipeline, options);
  }
}
