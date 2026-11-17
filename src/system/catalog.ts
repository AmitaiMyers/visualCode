import type { ComponentKind } from "./model";

/** Languages the integration guide writes client code for. */
export type PlanLanguage = "ts" | "py" | "go" | "java";

export const PLAN_LANGUAGE_LABEL: Record<PlanLanguage, string> = { ts: "TypeScript / JavaScript", py: "Python", go: "Go", java: "Java" };

/** How one language talks to a technology: the package to add and the code that creates the client. */
export interface ClientSetup {
  install: string; // shell command, or the dependency to add for build-file ecosystems
  init: string; // client creation, reading the connection settings from the environment
}

/** An environment variable the app reads: its value inside docker compose and when running on the host. */
export interface EnvSetting {
  name: string;
  compose: string;
  local: string;
}

/** Everything the guide needs to add a technology to a project. */
export interface IntegrationGuide {
  composeService: string; // the YAML of the service, indented for a compose "services:" map
  volume: string | null; // named volume the service stores data in
  env: EnvSetting[];
  clients: Record<PlanLanguage, ClientSetup>;
  usage: string; // where it goes in the code, shown with the touch points
  caveat: string | null;
}

export interface Technology {
  id: string;
  label: string;
  kind: ComponentKind;
  protocol: string; // connection label, e.g. "SQL"
  images: RegExp; // docker image names
  schemes: string[]; // connection URL schemes
  clientPatterns: RegExp; // a source line that uses the technology's client library
  guide: IntegrationGuide | null; // null: detected, but not offered in the add-component catalog
}

const REQUIRE_ENV_TS = `function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") throw new Error(\`\${name} is not set\`);
  return value;
}
`;

export const TECHNOLOGIES: Technology[] = [
  {
    id: "postgres",
    label: "PostgreSQL",
    kind: "database",
    protocol: "SQL",
    images: /^(postgres|postgis\/postgis|bitnami\/postgresql)(:|$)/,
    schemes: ["postgres", "postgresql"],
    clientPatterns: /(from\s+["']pg["']|require\(\s*["']pg["']\s*\)|\bimport\s+psycopg|\bpsycopg2?\b|\basyncpg\b|github\.com\/(lib\/pq|jackc\/pgx)|org\.postgresql|\bNpgsql\b|postgres(ql)?:\/\/)/,
    guide: {
      composeService: `  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - "5432:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data`,
      volume: "postgres-data",
      env: [{ name: "DATABASE_URL", compose: "postgres://app:app@postgres:5432/app", local: "postgres://app:app@localhost:5432/app" }],
      clients: {
        ts: {
          install: "npm install pg",
          init: `import pg from "pg";

${REQUIRE_ENV_TS}
export const db = new pg.Pool({ connectionString: requireEnv("DATABASE_URL") });`,
        },
        py: {
          install: 'pip install "psycopg[binary]"',
          init: `import os

import psycopg

db = psycopg.connect(os.environ["DATABASE_URL"])`,
        },
        go: {
          install: "go get github.com/jackc/pgx/v5",
          init: `pool, err := pgxpool.New(context.Background(), os.Getenv("DATABASE_URL"))
if err != nil {
	log.Fatalf("connect to postgres: %v", err)
}
defer pool.Close()`,
        },
        java: {
          install: "Add the dependency org.postgresql:postgresql",
          init: `Connection db = DriverManager.getConnection(System.getenv("DATABASE_URL"));`,
        },
      },
      usage: "Put the queries in one data-access module and call it from the handlers that need the data.",
      caveat: "Java's JDBC driver expects the URL as jdbc:postgresql://host:5432/app?user=app&password=app.",
    },
  },
  {
    id: "mysql",
    label: "MySQL",
    kind: "database",
    protocol: "SQL",
    images: /^(mysql|mariadb|bitnami\/mysql)(:|$)/,
    schemes: ["mysql", "mariadb"],
    clientPatterns: /(\bmysql2\b|\bpymysql\b|\bmysqlclient\b|go-sql-driver\/mysql|com\.mysql|\bMySqlConnector\b|mysql:\/\/)/i,
    guide: null,
  },
  {
    id: "mongodb",
    label: "MongoDB",
    kind: "database",
    protocol: "MongoDB wire",
    images: /^(mongo|bitnami\/mongodb)(:|$)/,
    schemes: ["mongodb", "mongodb+srv"],
    clientPatterns: /(from\s+["'](mongodb|mongoose)["']|require\(\s*["'](mongodb|mongoose)["']\s*\)|\bpymongo\b|\bmotor\b|mongo-driver|org\.mongodb|MongoDB\.Driver|mongodb(\+srv)?:\/\/)/,
    guide: {
      composeService: `  mongo:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db`,
      volume: "mongo-data",
      env: [{ name: "MONGODB_URL", compose: "mongodb://mongo:27017/app", local: "mongodb://localhost:27017/app" }],
      clients: {
        ts: {
          install: "npm install mongodb",
          init: `import { MongoClient } from "mongodb";

${REQUIRE_ENV_TS}
export const mongo = new MongoClient(requireEnv("MONGODB_URL"));
await mongo.connect();
export const db = mongo.db();`,
        },
        py: {
          install: "pip install pymongo",
          init: `import os

from pymongo import MongoClient

mongo = MongoClient(os.environ["MONGODB_URL"])
db = mongo.get_default_database()`,
        },
        go: {
          install: "go get go.mongodb.org/mongo-driver/v2/mongo",
          init: `client, err := mongo.Connect(options.Client().ApplyURI(os.Getenv("MONGODB_URL")))
if err != nil {
	log.Fatalf("connect to mongodb: %v", err)
}`,
        },
        java: {
          install: "Add the dependency org.mongodb:mongodb-driver-sync",
          init: `MongoClient mongo = MongoClients.create(System.getenv("MONGODB_URL"));`,
        },
      },
      usage: "Keep collection access in one data-access module; the handlers call it.",
      caveat: null,
    },
  },
  {
    id: "redis",
    label: "Redis",
    kind: "cache",
    protocol: "Redis",
    images: /^(redis|valkey\/valkey|bitnami\/redis|redis\/redis-stack)(:|$)/,
    schemes: ["redis", "rediss"],
    clientPatterns: /(\bioredis\b|from\s+["']redis["']|require\(\s*["']redis["']\s*\)|^\s*import\s+redis\b|^\s*from\s+redis\b|go-redis|\bJedis\w*\b|\blettuce\b|StackExchange\.Redis|\bpredis\b|redis(s)?:\/\/)/,
    guide: {
      composeService: `  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"`,
      volume: null,
      env: [{ name: "REDIS_URL", compose: "redis://redis:6379", local: "redis://localhost:6379" }],
      clients: {
        ts: {
          install: "npm install redis",
          init: `import { createClient } from "redis";

${REQUIRE_ENV_TS}
export const redis = createClient({ url: requireEnv("REDIS_URL") });
redis.on("error", (error) => console.error("Redis error", error));
await redis.connect();`,
        },
        py: {
          install: "pip install redis",
          init: `import os

import redis

cache = redis.Redis.from_url(os.environ["REDIS_URL"], decode_responses=True)`,
        },
        go: {
          install: "go get github.com/redis/go-redis/v9",
          init: `opts, err := redis.ParseURL(os.Getenv("REDIS_URL"))
if err != nil {
	log.Fatalf("parse REDIS_URL: %v", err)
}
rdb := redis.NewClient(opts)`,
        },
        java: {
          install: "Add the dependency redis.clients:jedis",
          init: `JedisPooled redis = new JedisPooled(URI.create(System.getenv("REDIS_URL")));`,
        },
      },
      usage:
        "Cache-aside on read paths: look the key up in Redis; on a miss read from the database, then store the result with a TTL. Delete the key wherever the data is written.",
      caveat: null,
    },
  },
  {
    id: "kafka",
    label: "Kafka",
    kind: "queue",
    protocol: "Kafka",
    images: /^(apache\/kafka|confluentinc\/cp-kafka|bitnami\/kafka|redpandadata\/redpanda)(:|$)/,
    schemes: ["kafka"],
    clientPatterns: /(\bkafkajs\b|kafka-python|\bconfluent_kafka\b|segmentio\/kafka-go|\bsarama\b|org\.apache\.kafka|Confluent\.Kafka)/,
    guide: {
      composeService: `  kafka:
    image: apache/kafka:3.8.0
    environment:
      KAFKA_NODE_ID: 1
      KAFKA_PROCESS_ROLES: broker,controller
      KAFKA_LISTENERS: PLAINTEXT://:9092,CONTROLLER://:9093
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_CONTROLLER_LISTENER_NAMES: CONTROLLER
      KAFKA_LISTENER_SECURITY_PROTOCOL_MAP: CONTROLLER:PLAINTEXT,PLAINTEXT:PLAINTEXT
      KAFKA_CONTROLLER_QUORUM_VOTERS: 1@kafka:9093
      KAFKA_OFFSETS_TOPIC_REPLICATION_FACTOR: 1
    ports:
      - "9092:9092"`,
      volume: null,
      env: [{ name: "KAFKA_BROKERS", compose: "kafka:9092", local: "localhost:9092" }],
      clients: {
        ts: {
          install: "npm install kafkajs",
          init: `import { Kafka } from "kafkajs";

${REQUIRE_ENV_TS}
const kafka = new Kafka({ clientId: "app", brokers: requireEnv("KAFKA_BROKERS").split(",") });
export const producer = kafka.producer();
await producer.connect();`,
        },
        py: {
          install: "pip install confluent-kafka",
          init: `import os

from confluent_kafka import Producer

producer = Producer({"bootstrap.servers": os.environ["KAFKA_BROKERS"]})`,
        },
        go: {
          install: "go get github.com/segmentio/kafka-go",
          init: `writer := &kafka.Writer{
	Addr:  kafka.TCP(strings.Split(os.Getenv("KAFKA_BROKERS"), ",")...),
	Topic: "events",
}
defer writer.Close()`,
        },
        java: {
          install: "Add the dependency org.apache.kafka:kafka-clients",
          init: `Properties props = new Properties();
props.put("bootstrap.servers", System.getenv("KAFKA_BROKERS"));
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
KafkaProducer<String, String> producer = new KafkaProducer<>(props);`,
        },
      },
      usage: "Publish an event after each successful write; move slow follow-up work (emails, analytics) into a consumer.",
      caveat: "The broker advertises kafka:9092, which resolves inside compose. Apps running on the host need a second listener advertised as localhost.",
    },
  },
  {
    id: "rabbitmq",
    label: "RabbitMQ",
    kind: "queue",
    protocol: "AMQP",
    images: /^(rabbitmq|bitnami\/rabbitmq)(:|$)/,
    schemes: ["amqp", "amqps"],
    clientPatterns: /(\bamqplib\b|\bamqp-connection-manager\b|^\s*import\s+pika\b|\bpika\.|amqp091-go|streadway\/amqp|com\.rabbitmq|RabbitMQ\.Client|amqps?:\/\/)/,
    guide: {
      composeService: `  rabbitmq:
    image: rabbitmq:3-management
    ports:
      - "5672:5672"
      - "15672:15672"`,
      volume: null,
      env: [{ name: "RABBITMQ_URL", compose: "amqp://guest:guest@rabbitmq:5672", local: "amqp://guest:guest@localhost:5672" }],
      clients: {
        ts: {
          install: "npm install amqplib",
          init: `import amqp from "amqplib";

${REQUIRE_ENV_TS}
export const connection = await amqp.connect(requireEnv("RABBITMQ_URL"));
export const channel = await connection.createChannel();`,
        },
        py: {
          install: "pip install pika",
          init: `import os

import pika

connection = pika.BlockingConnection(pika.URLParameters(os.environ["RABBITMQ_URL"]))
channel = connection.channel()`,
        },
        go: {
          install: "go get github.com/rabbitmq/amqp091-go",
          init: `conn, err := amqp.Dial(os.Getenv("RABBITMQ_URL"))
if err != nil {
	log.Fatalf("connect to rabbitmq: %v", err)
}
defer conn.Close()`,
        },
        java: {
          install: "Add the dependency com.rabbitmq:amqp-client",
          init: `ConnectionFactory factory = new ConnectionFactory();
factory.setUri(System.getenv("RABBITMQ_URL"));
Connection connection = factory.newConnection();`,
        },
      },
      usage: "Publish a message where work can happen later; a worker consumes the queue and does it.",
      caveat: null,
    },
  },
  {
    id: "s3",
    label: "S3 storage",
    kind: "storage",
    protocol: "S3 API",
    images: /^(minio\/minio|localstack\/localstack|bitnami\/minio)(:|$)/,
    schemes: ["s3"],
    clientPatterns: /(@aws-sdk\/client-s3|\bS3Client\b|^\s*import\s+boto3\b|boto3\.client\(\s*["']s3|service\/s3\b|software\.amazon\.awssdk\.services\.s3|Amazon\.S3|\bminio\b|s3:\/\/)/,
    guide: {
      composeService: `  minio:
    image: minio/minio
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    ports:
      - "9000:9000"
      - "9001:9001"
    volumes:
      - minio-data:/data`,
      volume: "minio-data",
      env: [
        { name: "S3_ENDPOINT", compose: "http://minio:9000", local: "http://localhost:9000" },
        { name: "AWS_ACCESS_KEY_ID", compose: "minioadmin", local: "minioadmin" },
        { name: "AWS_SECRET_ACCESS_KEY", compose: "minioadmin", local: "minioadmin" },
        { name: "AWS_REGION", compose: "us-east-1", local: "us-east-1" },
      ],
      clients: {
        ts: {
          install: "npm install @aws-sdk/client-s3",
          init: `import { S3Client } from "@aws-sdk/client-s3";

${REQUIRE_ENV_TS}
// Credentials and region come from AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION.
export const s3 = new S3Client({ endpoint: requireEnv("S3_ENDPOINT"), forcePathStyle: true });`,
        },
        py: {
          install: "pip install boto3",
          init: `import os

import boto3

s3 = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT"])`,
        },
        go: {
          install: "go get github.com/aws/aws-sdk-go-v2/config github.com/aws/aws-sdk-go-v2/service/s3",
          init: `cfg, err := config.LoadDefaultConfig(context.Background())
if err != nil {
	log.Fatalf("load aws config: %v", err)
}
client := s3.NewFromConfig(cfg, func(o *s3.Options) {
	o.BaseEndpoint = aws.String(os.Getenv("S3_ENDPOINT"))
	o.UsePathStyle = true
})`,
        },
        java: {
          install: "Add the dependency software.amazon.awssdk:s3",
          init: `S3Client s3 = S3Client.builder()
    .endpointOverride(URI.create(System.getenv("S3_ENDPOINT")))
    .forcePathStyle(true)
    .build();`,
        },
      },
      usage: "Store uploaded files in a bucket and keep only the object key in the database.",
      caveat: "MinIO stands in for S3 locally. In production, drop S3_ENDPOINT and path-style access and use real AWS credentials.",
    },
  },
];

export function technologyById(id: string): Technology {
  const technology = TECHNOLOGIES.find((candidate) => candidate.id === id);
  if (technology === undefined) throw new Error(`Unknown technology: ${id}`);
  return technology;
}

export function isTechnologyId(id: string | null): id is string {
  return id !== null && TECHNOLOGIES.some((candidate) => candidate.id === id);
}
