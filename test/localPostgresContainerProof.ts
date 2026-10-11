import { execFileSync } from "node:child_process";

const LOCAL_DOCKER_SOCKET = "unix:///var/run/docker.sock";
const MAX_CANDIDATES = 8;
const LOOPBACK_OR_WILDCARD = new Set(["127.0.0.1", "::1", "0.0.0.0", "::"]);
const INSPECTION_FORMAT =
  '{"running":{{json .State.Running}},"image":{{json .Config.Image}},"networks":{{json .NetworkSettings.Networks}},"ports":{{json .NetworkSettings.Ports}}}';

type ContainerMetadata = {
  running?: unknown;
  image?: unknown;
  networks?: Record<
    string,
    { IPAddress?: unknown; GlobalIPv6Address?: unknown }
  >;
  ports?: Record<
    string,
    Array<{ HostIp?: unknown; HostPort?: unknown }> | null
  >;
};

function readLocalDocker(args: string[]): string {
  const environment = { ...process.env };
  // A user's remote Docker context must never establish local routing proof.
  for (const key of [
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
  ]) {
    delete environment[key];
  }
  return execFileSync("docker", ["--host", LOCAL_DOCKER_SOCKET, ...args], {
    encoding: "utf8",
    env: environment,
    timeout: 1_000,
    maxBuffer: 65_536,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** Read-only routing proof, not proof of disposable or synthetic database contents. */
export function hasLocalPostgresContainerProof(input: {
  serverAddress: string;
  serverPort: number;
  hostPort: number;
}): boolean {
  if (
    !input.serverAddress ||
    ![input.serverPort, input.hostPort].every(
      (port) => Number.isInteger(port) && port > 0 && port <= 65_535,
    )
  ) {
    return false;
  }
  try {
    const candidates = readLocalDocker([
      "ps",
      "--filter",
      "status=running",
      "--filter",
      // Docker filters the published target port; inspect verifies its host binding.
      `publish=${input.serverPort}/tcp`,
      "--format",
      "{{.ID}}",
    ])
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (
      candidates.length === 0 ||
      candidates.length > MAX_CANDIDATES ||
      new Set(candidates).size !== candidates.length ||
      candidates.some((id) => !/^[a-f0-9]{12,64}$/.test(id))
    ) {
      return false;
    }
    let matches = 0;
    for (const id of candidates) {
      const metadata = JSON.parse(
        readLocalDocker([
          "inspect",
          "--type",
          "container",
          "--format",
          INSPECTION_FORMAT,
          id,
        ]),
      ) as ContainerMetadata;
      if (
        metadata?.running !== true ||
        typeof metadata.image !== "string" ||
        !/^(?:docker\.io\/)?(?:library\/)?postgres(?::[A-Za-z0-9_.-]+)?(?:@sha256:[a-f0-9]{64})?$/.test(
          metadata.image,
        )
      ) {
        continue;
      }
      const networks = Object.values(metadata.networks ?? {});
      const addressMatches = networks.some(
        (network) =>
          network?.IPAddress === input.serverAddress ||
          network?.GlobalIPv6Address === input.serverAddress,
      );
      const bindings = metadata.ports?.[`${input.serverPort}/tcp`];
      const portMatches =
        Array.isArray(bindings) &&
        bindings.some(
          (binding) =>
            typeof binding?.HostIp === "string" &&
            LOOPBACK_OR_WILDCARD.has(binding.HostIp) &&
            binding.HostPort === String(input.hostPort),
        );
      if (addressMatches && portMatches) matches += 1;
    }
    // Ambiguous evidence must not widen fixture access.
    return matches === 1;
  } catch {
    // Missing CLI/socket, timeout and invalid metadata all fail closed.
    return false;
  }
}
