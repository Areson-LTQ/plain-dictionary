import assert from 'node:assert/strict'
import test from 'node:test'
import { parseHtmlEntry } from './build-dictionary.mjs'

test('extracts IPA, translated part of speech and Chinese definitions', () => {
  const result = parseHtmlEntry(`
    <div>/<font color="gray">kəmˈpjutɚ</font>/<br>
      <div><font class="grammar" color="green">noun</font></div>
      A programmable electronic device.
      <ol><li><div>电脑</div></li><li><div>计算机</div></li></ol>
    </div>
  `)

  assert.equal(result.ipa, '/kəmˈpjutɚ/')
  assert.deepEqual([...result.groups.keys()], ['名词'])
  assert.deepEqual([...result.groups.get('名词')], ['电脑', '计算机'])
})

test('groups multiple parts of speech and removes duplicate translations', () => {
  const result = parseHtmlEntry(`
    <div>/<font color="gray">bʊk</font>/<br>
      <div><font class="grammar" color="green">noun</font></div>
      <ol><li><div>书</div></li><li><div>书</div></li></ol>
    </div>
    <div><div><font class="grammar" color="green">verb</font></div>
      <ol><li><div>预订</div></li></ol>
    </div>
  `)

  assert.deepEqual([...result.groups.get('名词')], ['书'])
  assert.deepEqual([...result.groups.get('动词')], ['预订'])
})

test('ignores English explanation text and entries without Chinese translations', () => {
  const result = parseHtmlEntry(`
    <div><div><font class="grammar" color="green">adjective</font></div>
      English explanation without a translation.
    </div>
  `)

  assert.equal(result.groups.size, 0)
})
