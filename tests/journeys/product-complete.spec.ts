import {test,expect} from '@playwright/test';
import {mkdir,readFile} from 'node:fs/promises';
test.beforeAll(async()=>{await mkdir('.artifacts/full',{recursive:true});});
test('J04/J07: two fixed opponent hypotheses, paired reports and theory conditions',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/settings');await page.getByRole('combobox',{name:'演示速度'}).selectOption('fast');
  await page.getByRole('link',{name:/局面库/}).first().click();await page.getByRole('button',{name:'打开 S06 研究',exact:true}).click();
  await page.getByRole('button',{name:'载入示例并固定为基准',exact:true}).click();await expect(page.getByText('模拟完成',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'建立过度弃牌实验',exact:true}).click();await page.getByRole('button',{name:'载入示例并固定为基准',exact:true}).click();await expect(page.getByRole('cell',{name:'3.40 bb',exact:true})).toBeVisible();
  await page.getByRole('link',{name:'打开固定基准',exact:true}).click();await page.getByRole('tab',{name:/Solver 研究/}).click();await page.getByRole('button',{name:'建立偏多跟注实验',exact:true}).click();await page.getByRole('button',{name:'载入示例并固定为基准',exact:true}).click();await expect(page.getByRole('cell',{name:'2.00 bb',exact:true})).toBeVisible();await expect(page.getByRole('cell',{name:'3.40 bb',exact:true})).toBeVisible();
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.artifacts/full/experiment-1440.png',fullPage:true,animations:'disabled'});
  await page.getByRole('link',{name:'查相关理论',exact:true}).click();await page.getByRole('button',{name:/K08/}).click();await expect(page.getByRole('dialog')).toContainText('Node Lock');await page.getByRole('button',{name:'打开假设实验',exact:true}).click();await page.getByRole('tab',{name:/全范围构建/}).click();await page.locator('#study-note').fill('仅在固定对手假设下比较，合成趋势不能推断真实收益。');await expect(page.getByText('已保存到本地',{exact:true})).toBeVisible();
  await page.goto('/knowledge?item=K05');await expect(page.getByRole('dialog')).toContainText('阻断与具体花色');await page.keyboard.press('Escape');
  expect(errors).toEqual([]);
});
test('J09: all extension previews preserve their own ranges, units and uncovered configurations',async({page})=>{
  const external:string[]=[];page.on('request',r=>{if(!['localhost','127.0.0.1'].includes(new URL(r.url()).hostname))external.push(r.url());});
  await page.goto('/settings');await page.getByRole('combobox',{name:'演示速度'}).selectOption('fast');await page.getByRole('checkbox',{name:'四色牌面',exact:true}).check();
  for(const id of ['S08','S09','S10']){
    await page.goto('/library');await page.getByRole('button',{name:`打开 ${id} 研究`,exact:true}).click();await page.getByRole('button',{name:'加载节点参考策略',exact:true}).click();await expect(page.getByRole('group',{name:'全范围推荐策略矩阵'})).toBeVisible();
    if(id==='S09'){await page.getByRole('button',{name:'双方范围',exact:true}).click();await page.getByRole('button',{name:'CO',exact:true}).click();await expect(page.getByText(/CO · \d+ 个组合/)).toBeVisible();}
  }
  await page.getByRole('button',{name:'编辑这个节点的完整范围',exact:true}).click();await page.getByRole('button',{name:'载入示例分配',exact:true}).click();await page.getByRole('button',{name:'确认载入',exact:true}).click();await page.getByRole('button',{name:'提交策略',exact:true}).click();await page.getByRole('button',{name:'运行模拟分析',exact:true}).click();await expect(page.getByText('固定价值模型 · 示例',{exact:true})).toBeVisible();await expect(page.getByText('奖池效用点',{exact:true})).toBeVisible();
  await page.getByRole('tab',{name:/Solver 研究/}).click();await page.getByRole('combobox',{name:'价值目标',exact:true}).selectOption('chipEV');await page.getByRole('button',{name:'保存预览配置修订',exact:true}).click();await page.getByRole('button',{name:'加载节点参考策略',exact:true}).click();await expect(page.getByRole('heading',{name:'当前节点没有匹配结果',exact:true})).toBeVisible();
  await page.setViewportSize({width:1024,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(external).toEqual([]);
});
test('J08/J09: corrupt storage can be downloaded intact and reset touches only this app; global jobs open fixed reports',async({page})=>{
  await page.goto('/library');
  await expect(page.getByRole('button',{name:'创建研究案例',exact:true})).toBeVisible();
  await page.evaluate(async()=>{localStorage.setItem('other-app-test','keep');const db=await new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open('riverline-demo-t1',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});await new Promise<void>((resolve,reject)=>{const tx=db.transaction('workspace','readwrite');tx.objectStore('workspace').put({schemaVersion:999,original:'retained'},'current');tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});db.close();});
  await page.reload();await expect(page.getByText('仅内存模式',{exact:true})).toBeVisible();await page.getByRole('link',{name:'演示设置',exact:true}).click();
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'导出原始存储记录',exact:true}).click();const file=await pending;expect(JSON.parse(await readFile((await file.path())!,'utf8'))).toEqual({schemaVersion:999,original:'retained'});
  await page.getByRole('button',{name:'重置本应用数据',exact:true}).click();await page.getByRole('button',{name:'确认重置本应用',exact:true}).click();await expect(page.getByText('已保存到本地',{exact:true})).toBeVisible();expect(await page.evaluate(()=>localStorage.getItem('other-app-test'))).toBe('keep');
  await page.getByRole('link',{name:/局面库/}).first().click();await page.getByRole('button',{name:'打开双版本示例',exact:true}).click();await page.getByRole('link',{name:'学习记录',exact:true}).click();await page.getByRole('button',{name:'求解任务',exact:true}).click();await page.getByRole('dialog').getByRole('button').filter({hasText:/completed/}).first().click();await page.getByRole('link',{name:'打开这份固定报告',exact:true}).click();await expect(page.getByRole('heading',{name:'范围结构反馈',exact:true})).toBeVisible();
});

test('J05: all four exercises finish with fixed evidence through the visible UI',async({page})=>{
  for(const [kind,answer] of [['全范围构建',''],['分支补全',''],['策略诊断','修正概率合计不足 100%'],['局面比较','不能，需要明确各版条件与评价模型']]){
    await page.goto('/practice');await page.getByRole('button',{name:`开始${kind}`,exact:true}).click();
    await expect(page.getByTestId('reference-range')).toHaveCount(0);
    if(answer)await page.getByRole('button',{name:answer,exact:true}).click();else await page.getByRole('button',{name:'剩余全部过牌',exact:true}).click();
    await page.getByRole('button',{name:'提交作答',exact:true}).click();await expect(page.getByRole('heading',{name:'本次反馈'})).toBeVisible();await page.getByRole('button',{name:'完成练习并查看记录',exact:true}).click();await expect(page.getByRole('heading',{name:'每一次改进，都回到实际作答。'})).toBeVisible();
  }
  await expect(page.locator('a').filter({hasText:'首次无提示作答'})).toHaveCount(0);
  await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:'.artifacts/full/four-exercises-1440.png',fullPage:true,animations:'disabled'});
});
