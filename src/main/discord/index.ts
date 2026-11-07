// Atlas on Discord (the phone access): see service.ts for the entry point and bridge.ts for what moves between the two.
export { DiscordService, type DiscordServiceOptions } from './service'
export { DiscordBridge } from './bridge'
export { DiscordGateway, nodeSocket, type SocketFactory, type SocketLike } from './gateway'
export { DiscordRest, DiscordError, scrub, type FetchLike } from './rest'
export { FakeDiscord, e2eDiscord } from './fake'
