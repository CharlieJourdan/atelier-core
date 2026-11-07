// Entry of the web demo build (`npm run web:app`): same React app as the desktop, with the stub bridge.
import { installWebBridge } from './bridge'

installWebBridge()

void import('../main')
