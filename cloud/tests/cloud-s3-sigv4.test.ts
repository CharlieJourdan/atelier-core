// SigV4 against the worked examples of the AWS documentation ("Signature Calculations for the Authorization Header" and
// "Authenticating Requests: Using Query Parameters"): the same inputs must give the same signatures, to the last hex digit.
import { describe, expect, it } from 'vitest'
import { canonicalQuery, presignUrl, sha256, signRequest, uriEncode, UNSIGNED_PAYLOAD } from '../src/blobs/sigv4.ts'

const credentials = { accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }
const now = new Date('2013-05-24T00:00:00Z')

describe('SigV4', () => {
  it('signs the documented GET Object request (Range header)', () => {
    const s = signRequest({
      method: 'GET',
      path: '/test.txt',
      query: [],
      headers: {
        host: 'examplebucket.s3.amazonaws.com',
        range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z'
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      credentials,
      region: 'us-east-1',
      service: 's3',
      now
    })
    expect(s.signedHeaders).toBe('host;range;x-amz-content-sha256;x-amz-date')
    expect(s.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41')
    expect(s.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    )
  })

  it('signs the documented PUT Object request (special character in the key, storage class header)', () => {
    const payloadHash = sha256('Welcome to Amazon S3.')
    expect(payloadHash).toBe('44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072')
    const s = signRequest({
      method: 'PUT',
      path: '/test$file.text',
      query: [],
      headers: {
        date: 'Fri, 24 May 2013 00:00:00 GMT',
        host: 'examplebucket.s3.amazonaws.com',
        'x-amz-date': '20130524T000000Z',
        'x-amz-storage-class': 'REDUCED_REDUNDANCY',
        'x-amz-content-sha256': payloadHash
      },
      payloadHash,
      credentials,
      region: 'us-east-1',
      service: 's3',
      now
    })
    expect(s.canonicalRequest.split('\n')[1]).toBe('/test%24file.text')
    expect(s.signature).toBe('98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd')
  })

  it('signs the documented presigned GET URL (24 hours)', () => {
    const url = presignUrl({ method: 'GET', origin: 'https://examplebucket.s3.amazonaws.com', path: '/test.txt', credentials, region: 'us-east-1', now, expiresS: 86_400 })
    const u = new URL(url)
    expect(u.host).toBe('examplebucket.s3.amazonaws.com')
    expect(u.pathname).toBe('/test.txt')
    expect(u.searchParams.get('X-Amz-Signature')).toBe('aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404')
    expect(u.searchParams.get('X-Amz-Expires')).toBe('86400')
    expect(u.searchParams.get('X-Amz-SignedHeaders')).toBe('host')
    expect(u.searchParams.get('X-Amz-Credential')).toBe('AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request')
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request')
    expect(UNSIGNED_PAYLOAD).toBe('UNSIGNED-PAYLOAD')
  })

  it('encodes like RFC 3986, sorts the query, and bounds the lifetime of a link', () => {
    expect(uriEncode("a b/é!*'()~-._")).toBe('a%20b%2F%C3%A9%21%2A%27%28%29~-._')
    expect(uriEncode('a/b c', true)).toBe('a/b%20c')
    expect(canonicalQuery([['b', '2'], ['a', '1 2'], ['a', '1']])).toBe('a=1&a=1%202&b=2')
    const base = { method: 'GET', origin: 'https://x.example', path: '/b/k', credentials, region: 'auto', now }
    expect(() => presignUrl({ ...base, expiresS: 0 })).toThrow(/1 second to 7 days/)
    expect(() => presignUrl({ ...base, expiresS: 604_801 })).toThrow(/1 second to 7 days/)
    expect(() => presignUrl({ ...base, expiresS: 1.5 })).toThrow()
  })
})
