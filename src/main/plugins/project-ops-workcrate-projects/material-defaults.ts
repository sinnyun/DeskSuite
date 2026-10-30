// Initial suggestions only. User edits and intentionally emptied lists persist.
export const materialDefaults = {
  fields: [
    { key: 'materialCategory', label: '物料类别', values: ['舞台区', '签到区', '展示区', '导视区', '互动区', '会议区', '餐饮区', '公共区域'] },
    { key: 'material', label: '物料名称', values: ['主背景板', '签到背景板', '签到台', '指示牌', '易拉宝', '展架', '桌牌', '胸牌', '地贴', '灯箱', '横幅', '宣传海报'] },
    { key: 'sizeLabel', label: '尺寸标签', values: ['成品尺寸', '画面尺寸', '制作尺寸', '安装尺寸', '展开尺寸', '可视尺寸'] },
    { key: 'size', label: '尺寸', values: ['60×90cm', '80×180cm', '80×200cm', '100×200cm', '120×240cm', '300×200cm', '400×300cm', '600×300cm', '210×297mm', '297×420mm'] },
    { key: 'quantity', label: '数量', values: ['1 个', '2 个', '5 个', '10 个', '20 个', '1 套', '2 套', '5 套', '10 张', '20 张', '50 张', '100 张'] },
    { key: 'stock', label: '材质', values: ['KT板', 'PVC板', '亚克力', '铝塑板', '写真背胶', '喷绘布', '网格布', '铜版纸', '哑粉纸', '不锈钢'] },
    { key: 'craft', label: '制作工艺', values: ['高清写真', 'UV打印', '喷绘', '双面印刷', '覆哑膜', '覆亮膜', '激光切割', '雕刻', '裱板'] },
    { key: 'color', label: '颜色', values: ['全彩', '黑色', '白色', '红色', '蓝色', '绿色', '金色', '银色', '透明'] },
    { key: 'installation', label: '安装方式', values: ['落地摆放', '墙面粘贴', '悬挂安装', '支架固定', '螺丝固定', '磁吸安装', '现场组装'] }
  ]
}
