(() => {
  'use strict';

  const STORAGE_KEY = 'mediflow_demo_state_v3';
  const SESSION_KEY = 'mediflow_demo_session_v3';
  const money = new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' });
  const fmtDate = (v) => v ? new Intl.DateTimeFormat('vi-VN').format(new Date(v + (v.length === 10 ? 'T00:00:00' : ''))) : '—';
  const today = () => new Date().toISOString().slice(0,10);
  const esc = (s='') => String(s).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  // Safe Markdown subset for AI output: HTML is escaped before formatting.
  const aiMarkdown = (value='') => {
    // Normalize escaped Markdown sometimes returned by models, then escape HTML.
    let text = String(value).replace(/\\([*_`#-])/g, '$1').replace(/\r\n?/g, '\n');
    text = esc(text);
    text = text.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
    const lines = text.split('\n');
    let html = '', listType = '';
    const closeList=()=>{ if(listType){ html += `</${listType}>`; listType=''; } };
    for(const raw of lines){
      const line=raw.trim();
      const heading=line.match(/^#{1,3}\s+(.+)$/);
      const ordered=line.match(/^\d+[.)]\s+(.+)$/);
      const bullet=line.match(/^[-*]\s+(.+)$/);
      if(heading){ closeList(); html += `<h4>${heading[1]}</h4>`; continue; }
      if(ordered || bullet){
        const wanted=ordered?'ol':'ul';
        if(listType!==wanted){ closeList(); html += `<${wanted}>`; listType=wanted; }
        html += `<li>${(ordered||bullet)[1]}</li>`; continue;
      }
      closeList();
      html += line ? `<div>${line}</div>` : '<br>';
    }
    closeList();
    return html;
  };
  const icon = (id) => `<svg><use href="#i-${id}"></use></svg>`;
  const byId = (id) => document.getElementById(id);
  const initials = (name='') => name.split(/\s+/).slice(-2).map(x => x[0] || '').join('').toUpperCase();
  const uid = (prefix, items) => `${prefix}${String((Math.max(0,...items.map(x => parseInt(String(x.id).replace(/\D/g,'')) || 0))+1)).padStart(3,'0')}`;
  const debounce = (fn, wait=250) => { let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args),wait); }; };


  // --- PATIENTS API (FastAPI + PostgreSQL) ---
  const API_BASE = 'http://127.0.0.1:8000/api';
  let apiPatients = [];
  let patientQuery = '';
  let patientGender = '';

  let apiUsers = [];
  let apiDoctors = [];
  let apiShifts = [];
  let apiAppointments = [];
  let apiMedicalRecords = [];
  let apiServices = [];
  let apiInvoices = [];
  let apiLogs = [];
  let reportSummary = null;
  let invoiceOptions = {appointments:[], services:[]};
  let patientGuidanceData = null;
  let patientPortalData = null;
  let invoiceQuery = '';
  let invoiceStatusQuery = '';
  let logQuery = '';
  let doctorQuery = '';
  let doctorSpecialty = '';
  let shiftDateQuery = '';
  let shiftDoctorQuery = '';
  let appointmentQuery = '';
  let appointmentDateQuery = '';
  let appointmentStatusQuery = '';
  let doctorRecordQuery = '';
  let doctorScheduleDate = '';

  const patientFromApi = (p) => ({
    dbId: Number(p.id),
    id: `BN${String(p.id).padStart(3,'0')}`,
    userId: p.user_id ?? null,
    fullName: p.full_name || '',
    dob: p.date_of_birth || '',
    gender: p.gender || '',
    phone: p.phone || '',
    address: p.address || ''
  });

  async function apiRequest(path, options={}){
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(session?.accessToken ? {'Authorization': `Bearer ${session.accessToken}`} : {}),
        ...(options.headers || {})
      }
    });

    if(response.status === 204) return null;

    let payload = null;
    try { payload = await response.json(); }
    catch { payload = null; }

    if(!response.ok){
      const detail = payload?.detail;
      let message = 'Không thể xử lý yêu cầu tới backend.';
      if(typeof detail === 'string') message = detail;
      else if(Array.isArray(detail)) message = detail.map(x=>x.msg).join('; ');
      throw new Error(message);
    }

    return payload;
  }

  const legacyUserIds = {admin:'U001',letan:'U002',bsan:'U003',ketoan:'U004',benhnhan:'U005'};
  const knownUserNames = {
    admin:'Nguyễn Minh Quân',
    letan:'Trần Thu Hà',
    bsan:'BS. Nguyễn Hoàng An',
    ketoan:'Lê Mai Phương',
    benhnhan:'Phạm Minh Đức'
  };

  const userFromApi = (u) => ({
    dbId: Number(u.id),
    id: legacyUserIds[u.username] || `DBU${u.id}`,
    username: u.username,
    fullName: u.full_name || knownUserNames[u.username] || u.username,
    email: u.email || '',
    role: u.role,
    status: u.status
  });

  async function loadApiUsers(){
    const data = await apiRequest('/users?limit=500');
    apiUsers = (data?.items || []).map(userFromApi);
    return apiUsers;
  }

  async function loadApiPatients(){
    const params = new URLSearchParams({limit:'200'});
    if(patientQuery.trim()) params.set('q', patientQuery.trim());
    if(patientGender) params.set('gender', patientGender);
    const data = await apiRequest(`/patients?${params.toString()}`);
    apiPatients = (data?.items || []).map(patientFromApi);
    return apiPatients;
  }

  const doctorFromApi = (d) => ({
    dbId: Number(d.id),
    id: `BS${String(d.id).padStart(3,'0')}`,
    userDbId: Number(d.user_id),
    fullName: d.full_name || '',
    specialty: d.specialty || '',
    phone: d.phone || '',
    licenseNo: d.license_no || '',
    status: d.status || 'active'
  });

  const shiftFromApi = (s) => ({
    dbId: Number(s.id),
    id: `CA${String(s.id).padStart(3,'0')}`,
    doctorDbId: Number(s.doctor_id),
    doctorId: `BS${String(s.doctor_id).padStart(3,'0')}`,
    date: s.shift_date || '',
    start: String(s.start_time || '').slice(0,5),
    end: String(s.end_time || '').slice(0,5),
    status: s.status || 'active'
  });

  async function loadApiDoctors(){
    const params = new URLSearchParams({limit:'200'});
    if(doctorQuery.trim()) params.set('q', doctorQuery.trim());
    if(doctorSpecialty) params.set('specialty', doctorSpecialty);
    const data = await apiRequest(`/doctors?${params.toString()}`);
    apiDoctors = (data?.items || []).map(doctorFromApi);
    return apiDoctors;
  }

  async function loadApiShifts(){
    const params = new URLSearchParams({limit:'500'});
    if(shiftDateQuery) params.set('shift_date', shiftDateQuery);
    if(shiftDoctorQuery){
      const doctor = apiDoctors.find(d=>d.id===shiftDoctorQuery);
      if(doctor) params.set('doctor_id', String(doctor.dbId));
    }
    const data = await apiRequest(`/shifts?${params.toString()}`);
    apiShifts = (data?.items || []).map(shiftFromApi);
    return apiShifts;
  }

  const appointmentFromApi = (a) => ({
    dbId: Number(a.id),
    id: `LK${String(a.id).padStart(3,'0')}`,
    patientDbId: Number(a.patient_id),
    patientId: `BN${String(a.patient_id).padStart(3,'0')}`,
    doctorDbId: Number(a.doctor_id),
    doctorId: `BS${String(a.doctor_id).padStart(3,'0')}`,
    createdBy: Number(a.created_by),
    date: a.appointment_date || '',
    start: String(a.start_time || '').slice(0,5),
    end: String(a.end_time || '').slice(0,5),
    reason: a.reason || '',
    status: a.status || 'pending'
  });

  async function loadApiAppointments(){
    const params = new URLSearchParams({limit:'500'});
    if(appointmentQuery.trim()) params.set('q', appointmentQuery.trim());
    if(appointmentDateQuery) params.set('appointment_date', appointmentDateQuery);
    if(appointmentStatusQuery) params.set('status', appointmentStatusQuery);
    const data = await apiRequest(`/appointments?${params.toString()}`);
    apiAppointments = (data?.items || []).map(appointmentFromApi);
    return apiAppointments;
  }

  const medicalRecordFromApi = (r) => ({
    dbId: Number(r.id),
    id: `PK${String(r.id).padStart(3,'0')}`,
    appointmentDbId: Number(r.appointment_id),
    appointmentId: `LK${String(r.appointment_id).padStart(3,'0')}`,
    patientDbId: Number(r.patient_id),
    patientId: `BN${String(r.patient_id).padStart(3,'0')}`,
    patientName: r.patient_name || '',
    doctorDbId: Number(r.doctor_id),
    doctorId: `BS${String(r.doctor_id).padStart(3,'0')}`,
    doctorName: r.doctor_name || '',
    appointmentDate: r.appointment_date || '',
    startTime: String(r.start_time || '').slice(0,5),
    symptoms: r.symptoms || '',
    conclusion: r.conclusion || '',
    doctorNote: r.doctor_note || '',
    prescriptionNote: r.prescription_note || '',
    postVisitGuidance: r.post_visit_guidance || '',
    createdAt: r.created_at || ''
  });

  const serviceFromApi = (s) => ({
    dbId: Number(s.id),
    id: `DV${String(s.id).padStart(3,'0')}`,
    name: s.name || '',
    unitPrice: Number(s.unit_price || 0),
    status: s.status || 'active'
  });

  const invoiceFromApi = (i) => ({
    dbId: Number(i.id),
    id: `HD${String(i.id).padStart(3,'0')}`,
    appointmentDbId: i.appointment_id == null ? null : Number(i.appointment_id),
    appointmentId: i.appointment_id == null ? '' : `LK${String(i.appointment_id).padStart(3,'0')}`,
    patientDbId: i.patient_id == null ? null : Number(i.patient_id),
    patientId: i.patient_id == null ? '' : `BN${String(i.patient_id).padStart(3,'0')}`,
    patientName: i.patient_name || '',
    patientPhone: i.patient_phone || '',
    invoiceDate: String(i.invoice_date || '').slice(0,10),
    discount: Number(i.discount_amount || 0),
    total: Number(i.total_amount || 0),
    paymentStatus: i.payment_status || 'unpaid',
    paymentMethod: i.payment_method || '',
    paidAt: i.paid_at || '',
    createdBy: Number(i.created_by || 0),
    items: (i.items || []).map(it => ({
      dbId: Number(it.id),
      serviceDbId: Number(it.service_id),
      serviceId: `DV${String(it.service_id).padStart(3,'0')}`,
      serviceName: it.service_name || '',
      quantity: Number(it.quantity || 1),
      unitPrice: Number(it.unit_price || 0),
      lineTotal: Number(it.line_total || 0)
    }))
  });

  async function loadDoctorContext(){
    const data = await apiRequest('/medical-records/context');

    const d = doctorFromApi(data.doctor);
    apiDoctors = [d];

    apiPatients = (data.patients || []).map(patientFromApi);
    apiAppointments = (data.appointments || []).map(appointmentFromApi);
    apiMedicalRecords = (data.records || []).map(medicalRecordFromApi);

    return data;
  }

  async function loadApiServices(){
    const data = await apiRequest('/services');
    apiServices = (data?.items || []).map(serviceFromApi);
    return apiServices;
  }

  async function loadApiInvoices(){
    const params = new URLSearchParams({limit:'500'});
    if(invoiceQuery.trim()) params.set('q', invoiceQuery.trim());
    if(invoiceStatusQuery) params.set('status', invoiceStatusQuery);
    const data = await apiRequest(`/invoices?${params.toString()}`);
    apiInvoices = (data?.items || []).map(invoiceFromApi);
    return apiInvoices;
  }

  async function loadInvoiceOptions(){
    const data = await apiRequest('/invoices/options');
    invoiceOptions = data || {appointments:[],services:[]};
    apiServices = (invoiceOptions.services || []).map(serviceFromApi);
    return invoiceOptions;
  }

  async function loadReportSummary(fromDate='',toDate=''){
    const params = new URLSearchParams();
    if(fromDate) params.set('from_date',fromDate);
    if(toDate) params.set('to_date',toDate);
    reportSummary = await apiRequest(`/reports/summary?${params.toString()}`);
    return reportSummary;
  }

  async function loadApiLogs(){
    const params = new URLSearchParams({limit:'500'});
    if(logQuery.trim()) params.set('q',logQuery.trim());
    const data = await apiRequest(`/logs?${params.toString()}`);
    apiLogs = data?.items || [];
    return apiLogs;
  }

  async function loadPatientGuidance(){
    patientGuidanceData = await apiRequest('/medical-records/my-guidance');
    const p = patientGuidanceData?.patient;
    if(p){
      apiPatients = [patientFromApi(p)];
    }
    return patientGuidanceData;
  }

  async function loadPatientPortal(){
    patientPortalData = await apiRequest('/patient-portal/context');
    if(patientPortalData?.patient) apiPatients = [patientFromApi(patientPortalData.patient)];
    apiDoctors = (patientPortalData?.doctors||[]).map(doctorFromApi);
    apiShifts = (patientPortalData?.shifts||[]).map(shiftFromApi);
    apiAppointments = (patientPortalData?.appointments||[]).map(appointmentFromApi);
    apiMedicalRecords = (patientPortalData?.records||[]).map(medicalRecordFromApi);
    return patientPortalData;
  }

  async function loadAppointmentReferences(){
    await Promise.all([
      loadApiPatients(),
      loadApiDoctors()
    ]);
    await loadApiShifts();
  }

  const roleMeta = {
    admin: { label:'Quản trị viên', color:'success' },
    receptionist: { label:'Lễ tân', color:'info' },
    doctor: { label:'Bác sĩ', color:'success' },
    accountant: { label:'Kế toán', color:'warning' },
    patient: { label:'Bệnh nhân', color:'neutral' }
  };

  const defaultState = {
    users: [
      {id:'U001',username:'admin',password:'admin123',fullName:'Nguyễn Minh Quân',email:'admin@mediflow.local',role:'admin',status:'active'},
      {id:'U002',username:'letan',password:'123456',fullName:'Trần Thu Hà',email:'letan@mediflow.local',role:'receptionist',status:'active'},
      {id:'U003',username:'bsan',password:'123456',fullName:'BS. Nguyễn Hoàng An',email:'an@mediflow.local',role:'doctor',status:'active'},
      {id:'U004',username:'ketoan',password:'123456',fullName:'Lê Mai Phương',email:'ketoan@mediflow.local',role:'accountant',status:'active'},
      {id:'U005',username:'benhnhan',password:'123456',fullName:'Phạm Minh Đức',email:'duc@example.com',role:'patient',status:'active'},
      {id:'U006',username:'bslinh',password:'123456',fullName:'BS. Vũ Thùy Linh',email:'linh@mediflow.local',role:'doctor',status:'active'},
      {id:'U007',username:'bsnam',password:'123456',fullName:'BS. Đỗ Thành Nam',email:'nam@mediflow.local',role:'doctor',status:'active'},
      {id:'U008',username:'patient2',password:'123456',fullName:'Nguyễn Thị Hương',email:'huong@example.com',role:'patient',status:'active'},
      {id:'U009',username:'patient3',password:'123456',fullName:'Trần Quốc Bảo',email:'bao@example.com',role:'patient',status:'active'}
    ],
    patients: [
      {id:'BN001',userId:'U005',fullName:'Phạm Minh Đức',dob:'1998-04-15',gender:'Nam',phone:'0985123456',address:'Thái Nguyên'},
      {id:'BN002',userId:'U008',fullName:'Nguyễn Thị Hương',dob:'1995-11-22',gender:'Nữ',phone:'0978123456',address:'Sông Công, Thái Nguyên'},
      {id:'BN003',userId:'U009',fullName:'Trần Quốc Bảo',dob:'1988-08-03',gender:'Nam',phone:'0912345678',address:'Phổ Yên, Thái Nguyên'},
      {id:'BN004',userId:null,fullName:'Lê Ngọc Mai',dob:'2001-02-19',gender:'Nữ',phone:'0966332211',address:'Đại Từ, Thái Nguyên'},
      {id:'BN005',userId:null,fullName:'Hoàng Văn Sơn',dob:'1979-06-26',gender:'Nam',phone:'0903221100',address:'Đồng Hỷ, Thái Nguyên'},
      {id:'BN006',userId:null,fullName:'Đỗ Minh Anh',dob:'2004-01-08',gender:'Nữ',phone:'0327123456',address:'Thái Nguyên'}
    ],
    doctors: [
      {id:'BS001',userId:'U003',fullName:'BS. Nguyễn Hoàng An',specialty:'Nội tổng quát',phone:'0901122334',licenseNo:'CCHN-00128',status:'active'},
      {id:'BS002',userId:'U006',fullName:'BS. Vũ Thùy Linh',specialty:'Tai Mũi Họng',phone:'0905566778',licenseNo:'CCHN-00241',status:'active'},
      {id:'BS003',userId:'U007',fullName:'BS. Đỗ Thành Nam',specialty:'Da liễu',phone:'0917888999',licenseNo:'CCHN-00317',status:'active'},
      {id:'BS004',userId:null,fullName:'BS. Trịnh Lan Anh',specialty:'Nhi khoa',phone:'0933557799',licenseNo:'CCHN-00402',status:'active'},
      {id:'BS005',userId:null,fullName:'BS. Phạm Quốc Huy',specialty:'Cơ xương khớp',phone:'0944778899',licenseNo:'CCHN-00456',status:'inactive'}
    ],
    shifts: [
      {id:'CA001',doctorId:'BS001',date:'2026-08-28',start:'08:00',end:'12:00',status:'active'},
      {id:'CA002',doctorId:'BS001',date:'2026-08-29',start:'13:30',end:'17:30',status:'active'},
      {id:'CA003',doctorId:'BS002',date:'2026-08-28',start:'13:30',end:'17:30',status:'active'},
      {id:'CA004',doctorId:'BS003',date:'2026-08-29',start:'08:00',end:'12:00',status:'active'},
      {id:'CA005',doctorId:'BS004',date:'2026-08-30',start:'08:00',end:'12:00',status:'active'}
    ],
    appointments: [
      {id:'LK001',patientId:'BN001',doctorId:'BS001',createdBy:'U002',date:'2026-08-28',start:'08:30',end:'09:00',reason:'Đau đầu, mệt mỏi',status:'confirmed',createdAt:'2026-08-26'},
      {id:'LK002',patientId:'BN002',doctorId:'BS002',createdBy:'U002',date:'2026-08-28',start:'14:00',end:'14:30',reason:'Đau họng kéo dài',status:'confirmed',createdAt:'2026-08-26'},
      {id:'LK003',patientId:'BN003',doctorId:'BS001',createdBy:'U002',date:'2026-08-28',start:'09:30',end:'10:00',reason:'Tái khám huyết áp',status:'completed',createdAt:'2026-08-20'},
      {id:'LK004',patientId:'BN004',doctorId:'BS003',createdBy:'U002',date:'2026-08-29',start:'08:30',end:'09:00',reason:'Dị ứng da',status:'confirmed',createdAt:'2026-08-27'},
      {id:'LK005',patientId:'BN001',doctorId:'BS001',createdBy:'U005',date:'2026-08-29',start:'14:00',end:'14:30',reason:'Tái khám',status:'pending',createdAt:'2026-08-27'},
      {id:'LK006',patientId:'BN005',doctorId:'BS001',createdBy:'U002',date:'2026-08-27',start:'10:30',end:'11:00',reason:'Đau bụng',status:'completed',createdAt:'2026-08-25'},
      {id:'LK007',patientId:'BN006',doctorId:'BS004',createdBy:'U002',date:'2026-08-30',start:'09:00',end:'09:30',reason:'Khám tổng quát',status:'confirmed',createdAt:'2026-08-28'},
      {id:'LK008',patientId:'BN002',doctorId:'BS002',createdBy:'U002',date:'2026-08-26',start:'15:00',end:'15:30',reason:'Viêm họng',status:'cancelled',createdAt:'2026-08-24'}
    ],
    medicalRecords: [
      {id:'PK001',appointmentId:'LK003',symptoms:'Đau đầu nhẹ, chóng mặt khi đứng dậy.',conclusion:'Theo dõi huyết áp, chưa ghi nhận dấu hiệu bất thường cấp tính.',doctorNote:'Nghỉ ngơi, đo huyết áp sáng/tối trong 7 ngày.',prescriptionNote:'Paracetamol 500mg: dùng khi đau đầu, tối đa 2 viên/ngày.',postVisitGuidance:'Theo dõi huyết áp 2 lần/ngày; hạn chế thức ăn mặn; tái khám sau 7 ngày hoặc sớm hơn nếu chóng mặt tăng.'},
      {id:'PK002',appointmentId:'LK006',symptoms:'Đau bụng âm ỉ sau ăn, không sốt.',conclusion:'Rối loạn tiêu hóa mức độ nhẹ.',doctorNote:'Ăn mềm, chia nhỏ bữa, theo dõi 48 giờ.',prescriptionNote:'Men vi sinh: 2 lần/ngày sau ăn.',postVisitGuidance:'Uống đủ nước, tránh đồ cay và dầu mỡ; nếu đau tăng, sốt hoặc nôn nhiều cần liên hệ phòng khám.'}
    ],
    services: [
      {id:'DV001',name:'Khám Nội tổng quát',unitPrice:180000,status:'active'},
      {id:'DV002',name:'Khám Tai Mũi Họng',unitPrice:200000,status:'active'},
      {id:'DV003',name:'Khám Da liễu',unitPrice:220000,status:'active'},
      {id:'DV004',name:'Khám Nhi',unitPrice:180000,status:'active'},
      {id:'DV005',name:'Đo huyết áp',unitPrice:30000,status:'active'},
      {id:'DV006',name:'Thay băng',unitPrice:80000,status:'active'},
      {id:'DV007',name:'Tư vấn dinh dưỡng',unitPrice:150000,status:'active'},
      {id:'DV008',name:'Điện tim',unitPrice:250000,status:'inactive'}
    ],
    invoices: [
      {id:'HD001',appointmentId:'LK003',createdBy:'U004',invoiceDate:'2026-08-28',discount:0,total:210000,paymentStatus:'paid',paymentMethod:'Chuyển khoản',paidAt:'2026-08-28 10:15',items:[{serviceId:'DV001',quantity:1,unitPrice:180000},{serviceId:'DV005',quantity:1,unitPrice:30000}]},
      {id:'HD002',appointmentId:'LK006',createdBy:'U004',invoiceDate:'2026-08-27',discount:20000,total:160000,paymentStatus:'paid',paymentMethod:'Tiền mặt',paidAt:'2026-08-27 11:10',items:[{serviceId:'DV001',quantity:1,unitPrice:180000}]},
      {id:'HD003',appointmentId:'LK002',createdBy:'U002',invoiceDate:'2026-08-28',discount:0,total:200000,paymentStatus:'unpaid',paymentMethod:'',paidAt:'',items:[{serviceId:'DV002',quantity:1,unitPrice:200000}]}
    ],
    systemLogs: [
      {id:'LOG001',userId:'U001',action:'LOGIN',module:'AUTH',entityId:'U001',details:'Đăng nhập tài khoản quản trị',createdAt:'2026-08-28 07:58'},
      {id:'LOG002',userId:'U003',action:'VIEW',module:'MEDICAL_RECORD',entityId:'PK001',details:'Bác sĩ truy cập hồ sơ khám được phân công',createdAt:'2026-08-28 09:34'},
      {id:'LOG003',userId:'U003',action:'AI_SUMMARY',module:'AI',entityId:'BN003',details:'Mô phỏng yêu cầu AI tóm tắt hồ sơ',createdAt:'2026-08-28 09:36'},
      {id:'LOG004',userId:'U004',action:'UPDATE',module:'INVOICE',entityId:'HD001',details:'Cập nhật trạng thái hóa đơn: Đã thanh toán',createdAt:'2026-08-28 10:15'}
    ]
  };

  const clone = (x) => JSON.parse(JSON.stringify(x));
  let state = loadState();
  let session = loadSession();
  let currentRoute = 'dashboard';

  function loadState(){
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || clone(defaultState); }
    catch { return clone(defaultState); }
  }
  function saveState(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function loadSession(){
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) || null; }
    catch { return null; }
  }
  function saveSession(){ sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); }
  function currentUser(){ return session?.user || state.users.find(u => u.id === session?.userId); }
  function currentPatient(){ const u=currentUser(); return apiPatients.find(p=>p.userId===u?.dbId) || state.patients.find(p=>p.userId===u?.id); }
  function currentDoctor(){ const u=currentUser(); return apiDoctors.find(d=>d.userDbId===u?.dbId) || state.doctors.find(d=>d.userId===u?.id); }
  function patientName(id){ return apiPatients.find(x=>x.id===id)?.fullName || state.patients.find(x=>x.id===id)?.fullName || id; }
  function doctorName(id){ return apiDoctors.find(x=>x.id===id)?.fullName || state.doctors.find(x=>x.id===id)?.fullName || id; }
  function serviceName(id){ return apiServices.find(x=>x.id===id)?.name || state.services.find(x=>x.id===id)?.name || id; }
  function appointmentLabel(id){ const a=apiAppointments.find(x=>x.id===id) || state.appointments.find(x=>x.id===id); return a ? `${a.id} • ${patientName(a.patientId)} • ${fmtDate(a.date)}` : id; }
  function statusLabel(status){
    return ({active:'Hoạt động',inactive:'Ngừng hoạt động',pending:'Chờ xác nhận',confirmed:'Đã xác nhận',completed:'Đã khám',cancelled:'Đã hủy',paid:'Đã thanh toán',unpaid:'Chưa thanh toán',locked:'Bị khóa'})[status] || status;
  }
  function statusClass(status){
    if(['active','completed','paid'].includes(status)) return 'success';
    if(['pending','unpaid'].includes(status)) return 'warning';
    if(['cancelled','locked','inactive'].includes(status)) return 'danger';
    if(['confirmed'].includes(status)) return 'info';
    return 'neutral';
  }
  function statusBadge(status){ return `<span class="status ${statusClass(status)}">${esc(statusLabel(status))}</span>`; }
  function log(action,module,entityId,details){
    state.systemLogs.unshift({id:uid('LOG',state.systemLogs),userId:currentUser()?.id||'SYSTEM',action,module,entityId,details,createdAt:new Date().toLocaleString('sv-SE').slice(0,16).replace('T',' ')}); saveState();
  }
  function toast(title, detail='', type='success'){
    const el=document.createElement('div'); el.className=`toast ${type}`; el.innerHTML=`${icon(type==='error'?'close':'check')}<div><strong>${esc(title)}</strong><small>${esc(detail)}</small></div>`; byId('toastStack').appendChild(el); setTimeout(()=>el.remove(),3300);
  }

  const menus = {
    admin: [
      ['Tổng quan','dashboard','home'],['Quản lý người dùng','users','users'],['Bác sĩ & chuyên khoa','doctors','doctor'],['Ca làm việc','shifts','calendar'],['Thống kê & báo cáo','reports','chart']
    ],
    receptionist: [
      ['Tổng quan','dashboard','home'],['Quản lý bệnh nhân','patients','users'],['Quản lý lịch khám','appointments','calendar'],['Hóa đơn & thanh toán','billing','money'],['Tìm kiếm & tra cứu','search','search']
    ],
    doctor: [
      ['Tổng quan','dashboard','home'],['Lịch khám được phân công','doctor-schedule','calendar'],['Tra cứu hồ sơ bệnh nhân','records','file'],['Khám bệnh','examination','doctor'],['Lập đơn thuốc','prescription','pill'],['AI tóm tắt hồ sơ','ai-summary','bot']
    ],
    accountant: [
      ['Tổng quan','dashboard','home'],['Quản lý dịch vụ','services','settings'],['Hóa đơn & thanh toán','invoices','money'],['Thống kê & báo cáo','finance-report','chart'],['Tìm kiếm & tra cứu','finance-search','search']
    ],
    patient: [
      ['Tổng quan','dashboard','home'],['Tài khoản cá nhân','profile','user'],['Đặt lịch khám','booking','calendar'],['Lịch khám của tôi','my-appointments','clock'],['Chatbot quy trình','chatbot','bot'],['Hướng dẫn sau khám','guidance','file']
    ]
  };

  const pageMeta = {
    dashboard:['Tổng quan','Theo dõi các thông tin quan trọng trong hệ thống'],users:['Quản lý người dùng','Tài khoản, vai trò và trạng thái truy cập'],doctors:['Bác sĩ & chuyên khoa','Quản lý thông tin bác sĩ và chuyên khoa'],shifts:['Ca làm việc','Phân công và theo dõi lịch làm việc bác sĩ'],reports:['Thống kê & báo cáo','Tổng quan lượt khám, doanh thu và lịch bác sĩ'],logs:['Nhật ký hệ thống','Theo dõi các thao tác quan trọng và hoạt động AI'],
    patients:['Quản lý bệnh nhân','Thêm, tra cứu và cập nhật hồ sơ bệnh nhân'],appointments:['Quản lý lịch khám','Đặt, đổi, hủy lịch và kiểm tra xung đột'],billing:['Hóa đơn & thanh toán','Tra cứu, lập hóa đơn và ghi nhận thanh toán'],search:['Tìm kiếm & tra cứu','Tìm nhanh bệnh nhân và lịch khám'],
    'doctor-schedule':['Lịch khám được phân công','Danh sách lịch khám thuộc phạm vi của bác sĩ'],'records':['Tra cứu hồ sơ bệnh nhân','Chỉ hiển thị hồ sơ thuộc phạm vi được phép'],'examination':['Khám bệnh','Ghi nhận triệu chứng, kết luận và phiếu khám'],'prescription':['Lập đơn thuốc','Ghi nội dung đơn thuốc cho lần khám'],'ai-summary':['AI tóm tắt hồ sơ','KT3 • AI thật qua FastAPI — không chẩn đoán'],
    services:['Quản lý dịch vụ','Danh mục dịch vụ và đơn giá'],'invoices':['Hóa đơn & thanh toán','Quản lý hóa đơn và trạng thái thanh toán'],'finance-report':['Thống kê & báo cáo','Theo dõi doanh thu và tình trạng thanh toán'],'finance-search':['Tìm kiếm & tra cứu','Tra cứu hóa đơn, thanh toán và dịch vụ'],
    profile:['Tài khoản cá nhân','Xem và cập nhật thông tin cá nhân'],'booking':['Đặt lịch khám','Chọn bác sĩ và thời gian khám phù hợp'],'my-appointments':['Lịch khám của tôi','Theo dõi, đổi hoặc hủy lịch khám cá nhân'],'chatbot':['Chatbot hỏi đáp quy trình','Mô phỏng trợ lý hành chính của phòng khám'],'guidance':['Hướng dẫn sau khám','Xem nội dung hướng dẫn của các lần khám đã hoàn tất']
  };

  function init(){
    buildDemoAccounts();
    byId('loginForm').addEventListener('submit', onLogin);
    byId('openRegisterBtn')?.addEventListener('click', openPatientRegistration);
    byId('logoutBtn').addEventListener('click', logout);
    byId('modalClose').addEventListener('click', closeModal);
    byId('modalBackdrop').addEventListener('click', e => { if(e.target===byId('modalBackdrop')) closeModal(); });
    byId('menuBtn').addEventListener('click',()=>document.querySelector('.sidebar').classList.toggle('open'));
    if(session?.accessToken && currentUser() && currentUser().status==='active') showApp(); else { session=null; sessionStorage.removeItem(SESSION_KEY); showLogin(); }
  }

  function buildDemoAccounts(){
    const ids=['U001','U002','U003','U004','U005'];
    byId('demoAccounts').innerHTML=ids.map(id=>{const u=state.users.find(x=>x.id===id);return `<button class="demo-account" data-demo="${u.username}"><strong>${roleMeta[u.role].label}</strong><small>${u.username} / ${u.password}</small></button>`}).join('');
    byId('demoAccounts').onclick=e=>{const b=e.target.closest('[data-demo]');if(!b)return;const u=state.users.find(x=>x.username===b.dataset.demo);byId('loginUsername').value=u.username;byId('loginPassword').value=u.password;};
  }

  async function onLogin(e){
    e.preventDefault();
    const username=byId('loginUsername').value.trim();
    const password=byId('loginPassword').value;
    byId('loginError').classList.add('hidden');

    try{
      const data=await apiRequest('/auth/login',{
        method:'POST',
        body:JSON.stringify({username,password})
      });
      const user=userFromApi(data.user);
      session={accessToken:data.access_token,user};
      saveSession();
      currentRoute='dashboard';
      showApp();
      toast('Đăng nhập thành công',`Xin chào ${user.fullName}`);
    }catch(err){
      byId('loginError').textContent=err.message==='Invalid username or password.'?'Tên đăng nhập hoặc mật khẩu không đúng.':err.message;
      byId('loginError').classList.remove('hidden');
    }
  }
  function openPatientRegistration(){
    openModal(
      'Đăng ký tài khoản bệnh nhân',
      'Tạo tài khoản để đặt lịch và theo dõi thông tin khám',
      `<form id="patientRegisterForm" class="form-grid">
        <label class="field required"><span>Họ và tên</span><input name="fullName" maxlength="120" required placeholder="Nguyễn Văn A"></label>
        <label class="field required"><span>Số điện thoại</span><input name="phone" maxlength="20" required placeholder="09xxxxxxxx"></label>
        <label class="field"><span>Ngày sinh</span><input name="dateOfBirth" type="date"></label>
        <label class="field"><span>Giới tính</span><select name="gender"><option value="">-- Chọn --</option><option value="Nam">Nam</option><option value="Nữ">Nữ</option><option value="Khác">Khác</option></select></label>
        <label class="field full"><span>Địa chỉ</span><input name="address" maxlength="255" placeholder="Địa chỉ liên hệ"></label>
        <label class="field required"><span>Tên đăng nhập</span><input name="username" minlength="3" maxlength="50" pattern="[A-Za-z0-9_.-]+" required autocomplete="username" placeholder="nguyenvana"></label>
        <label class="field"><span>Email</span><input name="email" type="email" maxlength="120" autocomplete="email" placeholder="email@example.com"></label>
        <label class="field required"><span>Mật khẩu</span><input name="password" type="password" minlength="6" required autocomplete="new-password"></label>
        <label class="field required"><span>Nhập lại mật khẩu</span><input name="confirmPassword" type="password" minlength="6" required autocomplete="new-password"></label>
        <p id="registerError" class="form-error hidden full"></p>
      </form>`,
      `<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-register-patient>Đăng ký</button>`
    );
    bindModalCancel();
    byId('modalFooter').querySelector('[data-register-patient]').onclick = async()=>{
      const form=byId('patientRegisterForm');
      if(!form.reportValidity()) return;
      const fd=new FormData(form);
      const password=String(fd.get('password')||'');
      const confirmPassword=String(fd.get('confirmPassword')||'');
      const error=byId('registerError');
      error.classList.add('hidden');
      if(password!==confirmPassword){
        error.textContent='Mật khẩu nhập lại không khớp.';
        error.classList.remove('hidden');
        return;
      }
      const btn=byId('modalFooter').querySelector('[data-register-patient]');
      btn.disabled=true;
      try{
        const payload={
          full_name:String(fd.get('fullName')||'').trim(),
          phone:String(fd.get('phone')||'').trim(),
          date_of_birth:String(fd.get('dateOfBirth')||'')||null,
          gender:String(fd.get('gender')||'')||null,
          address:String(fd.get('address')||'').trim()||null,
          username:String(fd.get('username')||'').trim(),
          email:String(fd.get('email')||'').trim()||null,
          password
        };
        const data=await apiRequest('/auth/register-patient',{method:'POST',body:JSON.stringify(payload)});
        const user=userFromApi(data.user);
        session={accessToken:data.access_token,user};
        saveSession();
        closeModal();
        currentRoute='dashboard';
        showApp();
        toast('Đăng ký thành công',`Chào mừng ${user.fullName}`);
      }catch(err){
        error.textContent=err.message;
        error.classList.remove('hidden');
      }finally{
        btn.disabled=false;
      }
    };
  }

  function logout(){ session=null;sessionStorage.removeItem(SESSION_KEY);document.querySelector('.sidebar').classList.remove('open');showLogin(); }
  function showLogin(){ byId('appShell').classList.add('hidden');byId('loginScreen').classList.remove('hidden');buildDemoAccounts(); }
  function showApp(){ byId('loginScreen').classList.add('hidden');byId('appShell').classList.remove('hidden');renderUser();renderNav();navigate(currentRoute);updateBackendBadge(); }

  async function updateBackendBadge(){
    const box=document.querySelector('.demo-mode');
    if(!box) return;
    try{
      await apiRequest('/health');
      box.innerHTML='<span class="dot"></span><div><strong>Backend online</strong><small>FastAPI + PostgreSQL</small></div>';
    }catch{
      box.innerHTML='<span class="dot"></span><div><strong>Backend offline</strong><small>Kiểm tra FastAPI cổng 8000</small></div>';
    }
  }
  function renderUser(){ const u=currentUser(); byId('userName').textContent=u.fullName;byId('userRole').textContent=roleMeta[u.role].label;byId('userAvatar').textContent=initials(u.fullName);byId('rolePill').innerHTML=`<strong>${roleMeta[u.role].label}</strong>Giao diện theo quyền người dùng`; }
  function renderNav(){ const role=currentUser().role;byId('sidebarNav').innerHTML=`<div class="nav-group-title">Chức năng</div>`+menus[role].map(([label,route,ic])=>`<button class="nav-link ${route===currentRoute?'active':''}" data-route="${route}">${icon(ic)}<span>${label}</span></button>`).join('');byId('sidebarNav').onclick=e=>{const b=e.target.closest('[data-route]');if(b)navigate(b.dataset.route)}; }
  function navigate(route){
    const allowed=menus[currentUser().role].some(x=>x[1]===route); if(!allowed) route='dashboard'; currentRoute=route; renderNav();
    document.querySelector('.sidebar').classList.remove('open'); const [title,sub]=pageMeta[route]||['Trang','']; byId('pageTitle').textContent=title;byId('pageSubtitle').textContent=sub;
    const fn=routes[route]||renderDashboard; byId('content').innerHTML=fn(); bindRoute(route); window.scrollTo(0,0);
  }
  function bindRoute(route){
    const handler=routeBinders[route]; if(handler) handler();
  }

  function pageHead(title,desc,actions=''){ return `<div class="page-actions"><div><h2>${title}</h2><p>${desc}</p></div><div class="action-row">${actions}</div></div>`; }
  function cardTable(headers,rows,toolbar=''){ return `<div class="card">${toolbar}<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows||`<tr><td colspan="${headers.length}" class="empty"><strong>Không có dữ liệu</strong>Chưa có dữ liệu phù hợp để hiển thị.</td></tr>`}</tbody></table></div></div>`; }
  function metric(label,value,note=''){ return `<div class="card metric"><div class="metric-label">${label}</div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`; }
  function actionBtn(label,ic,onclickClass='primary',attrs=''){ return `<button class="btn btn-${onclickClass}" ${attrs}>${icon(ic)}${label}</button>`; }

  function renderDashboard(){
    const role=currentUser().role; if(role==='admin') return dashboardAdmin(); if(role==='receptionist') return dashboardReceptionist(); if(role==='doctor') return dashboardDoctor(); if(role==='accountant') return dashboardAccountant(); return dashboardPatient();
  }
  function dashboardAdmin(){
    const activeUsers=apiUsers.filter(x=>x.status==='active').length;
    const activeDoctors=apiDoctors.filter(x=>x.status==='active').length;
    const summary=reportSummary||{};
    const appts=Number(summary.appointments_total||0);
    const revenue=Number(summary.revenue||0);
    return `${pageHead('Tổng quan quản trị','Theo dõi người dùng, bác sĩ, ca làm và báo cáo tổng hợp')}
      <div class="grid grid-4">${metric('Người dùng hoạt động',activeUsers,'Tài khoản PostgreSQL')}${metric('Bác sĩ hoạt động',activeDoctors,'Hồ sơ bác sĩ')}${metric('Tổng lượt khám',appts,'Số liệu báo cáo')}${metric('Doanh thu',money.format(revenue),'Số liệu tổng hợp')}</div>
      <div class="grid grid-2" style="margin-top:18px"><div class="card"><div class="section-title"><div><h3>Trạng thái lịch khám</h3><p>Tổng hợp phục vụ quản trị</p></div></div><div class="list">${Object.entries(summary.appointments_by_status||{}).map(([status,n])=>`<div class="list-item"><div class="grow"><strong>${statusLabel(status)}</strong></div><span class="pill">${n}</span></div>`).join('')||'<div class="empty">Chưa có dữ liệu</div>'}</div></div><div class="card"><div class="section-title"><div><h3>Doanh thu theo ngày</h3><p>Dữ liệu báo cáo tổng hợp</p></div></div><div class="list">${(summary.revenue_by_date||[]).slice(-6).map(x=>`<div class="list-item"><div class="grow"><strong>${fmtDate(x.date)}</strong></div><strong>${money.format(Number(x.revenue||0))}</strong></div>`).join('')||'<div class="empty">Chưa có doanh thu</div>'}</div></div></div>
      <div class="card card-pad" style="margin-top:18px"><div class="quick-actions">${quick('users','Quản lý người dùng','users','Tạo, khóa và phân quyền')}${quick('doctor','Bác sĩ & chuyên khoa','doctors','Quản lý hồ sơ bác sĩ')}${quick('calendar','Ca làm việc','shifts','Phân công lịch bác sĩ')}${quick('chart','Báo cáo','reports','Lượt khám & doanh thu')}</div></div>`;
  }

  function dashboardReceptionist(){
    const todayValue=today();
    const todayAppts=apiAppointments.filter(a=>a.date===todayValue&&a.status!=='cancelled');
    return `${pageHead('Bàn tiếp đón','Dữ liệu bệnh nhân và lịch khám thật từ PostgreSQL',actionBtn('Đặt lịch mới','plus','primary','data-go="appointments"'))}<div class="grid grid-4">${metric('Bệnh nhân',apiPatients.length,'Hồ sơ PostgreSQL')}${metric('Lịch hôm nay',todayAppts.length,'Đã loại lịch hủy')}${metric('Chờ thanh toán',apiInvoices.filter(x=>x.paymentStatus==='unpaid').length,'Hóa đơn chưa thu')}${metric('Bác sĩ có ca',new Set(apiShifts.filter(x=>x.date===todayValue).map(x=>x.doctorId)).size,'Trong ngày')}</div><div class="split" style="margin-top:18px"><div class="card"><div class="section-title"><div><h3>Lịch khám hôm nay</h3><p>Danh sách cần tiếp nhận</p></div><button class="btn btn-ghost btn-sm" data-go="appointments">Xem tất cả</button></div><div class="list">${todayAppts.map(a=>`<div class="list-item"><span class="avatar">${a.start.slice(0,2)}</span><div class="grow"><strong>${patientName(a.patientId)}</strong><small>${a.start} • ${doctorName(a.doctorId)} • ${esc(a.reason||'')}</small></div>${statusBadge(a.status)}</div>`).join('')||'<div class="empty">Hôm nay chưa có lịch.</div>'}</div></div><div class="card card-pad"><div class="quick-actions">${quick('users','Thêm bệnh nhân','patients','Tạo hồ sơ')}${quick('calendar','Đặt lịch','appointments','Kiểm tra trùng lịch')}${quick('money','Lập hóa đơn','billing','Ghi nhận thanh toán')}${quick('search','Tra cứu','search','Tìm hồ sơ & lịch')}</div></div></div>`;
  }

  function dashboardDoctor(){
    const d=currentDoctor();
    const my=myDoctorAppointments();
    const assignedPatients=new Set(my.map(x=>x.patientId)).size;
    return `${pageHead('Không gian làm việc bác sĩ',`Xin chào ${esc(currentUser().fullName)} • ${esc(d?.specialty||'Chưa liên kết hồ sơ bác sĩ')}`)}<div class="grid grid-4">${metric('Lịch được phân công',my.length,'Từ PostgreSQL')}${metric('Bệnh nhân liên quan',assignedPatients,'Theo lịch được phân công')}${metric('Đã hoàn tất',my.filter(x=>x.status==='completed').length,'Lịch đã khám')}${metric('Hồ sơ khám',apiMedicalRecords.length,'Phiếu khám đã ghi nhận')}</div><div class="split" style="margin-top:18px"><div class="card"><div class="section-title"><div><h3>Lịch làm việc</h3><p>Các lịch gần nhất</p></div></div><div class="timeline card-pad">${my.slice(0,6).map(a=>`<div class="timeline-item"><div class="timeline-time">${fmtDate(a.date)}<br>${a.start}</div><div class="timeline-line"></div><div class="timeline-body"><strong>${patientName(a.patientId)}</strong><small>${esc(a.reason||'')} • ${statusLabel(a.status)}</small></div></div>`).join('')||'<div class="empty">Chưa có lịch được phân công.</div>'}</div></div><div class="card ai-panel"><div class="section-title"><div><h3>AI hỗ trợ hồ sơ</h3><p>KT3 • AI qua backend • Không chẩn đoán</p></div></div><div class="ai-output"><span class="ai-badge">AI • KT3</span><br>AI được gọi qua FastAPI sau khi kiểm tra quyền và giảm dữ liệu định danh không cần thiết.</div></div></div>`;
  }

  function dashboardAccountant(){
    const paid=apiInvoices.filter(x=>x.paymentStatus==='paid');
    const revenue=paid.reduce((s,x)=>s+x.total,0);
    const unpaid=apiInvoices.filter(x=>x.paymentStatus==='unpaid').reduce((s,x)=>s+x.total,0);
    return `${pageHead('Tổng quan tài chính','Hóa đơn, dịch vụ và doanh thu thật từ PostgreSQL',actionBtn('Lập hóa đơn','plus','primary','data-new-invoice'))}<div class="grid grid-4">${metric('Doanh thu đã thu',money.format(revenue),'Hóa đơn paid')}${metric('Chưa thanh toán',money.format(unpaid),'Hóa đơn unpaid')}${metric('Tổng hóa đơn',apiInvoices.length,'Dữ liệu PostgreSQL')}${metric('Dịch vụ hoạt động',apiServices.filter(x=>x.status==='active').length,'Danh mục đang dùng')}</div><div class="card" style="margin-top:18px"><div class="section-title"><div><h3>Hóa đơn gần đây</h3><p>Trạng thái thanh toán</p></div></div><div class="list">${apiInvoices.slice(0,6).map(i=>`<div class="list-item"><span class="avatar">HD</span><div class="grow"><strong>${i.id} • ${esc(i.patientName||'')}</strong><small>${fmtDate(i.invoiceDate)} • ${money.format(i.total)}</small></div>${statusBadge(i.paymentStatus)}</div>`).join('')||'<div class="empty">Chưa có hóa đơn.</div>'}</div></div>`;
  }

  function dashboardPatient(){
    const p=currentPatient();
    const records=apiMedicalRecords;
    return `${pageHead('Xin chào, '+esc(p?.fullName||currentUser().fullName),'Theo dõi thông tin cá nhân và hồ sơ khám')}<div class="grid grid-4">${metric('Hướng dẫn sau khám',records.filter(r=>r.postVisitGuidance).length,'Nội dung từ phiếu khám')}${metric('Hồ sơ đã liên kết',p?'Có':'Chưa','Liên kết với tài khoản')}${metric('Chatbot','Sẵn sàng','Hỗ trợ quy trình khám')}${metric('Đăng nhập','An toàn','Bảo mật tài khoản')}</div>`;
  }
  function quick(ic,label,route,desc){ return `<button class="quick-action" data-go="${route}">${icon(ic)}<strong>${label}</strong><small>${desc}</small></button>`; }
  function renderBars(finance=false){ const vals=finance?[35,52,40,68,74,56,82]:[4,7,5,8,6,9,7]; const labels=['T2','T3','T4','T5','T6','T7','CN'];return `<div class="chart-bars">${vals.map((v,i)=>`<div class="bar-col"><span>${finance?Math.round(v*0.1)+'tr':v}</span><div class="bar" style="height:${v}%"></div><strong>${labels[i]}</strong></div>`).join('')}</div>`; }
  function renderDonut(){ const total=state.appointments.length,c=state.appointments.filter(x=>x.status==='completed').length,p=state.appointments.filter(x=>['confirmed','pending'].includes(x.status)).length,x=state.appointments.filter(x=>x.status==='cancelled').length;return `<div class="donut-wrap"><div class="donut"></div><div class="legend"><span><i></i>Đã khám: ${c}/${total}</span><span><i></i>Đang chờ: ${p}/${total}</span><span><i></i>Đã hủy: ${x}/${total}</span></div></div>`; }

  // --- ADMIN PAGES ---
  function renderUsers(){
    const rows=apiUsers.map(u=>`<tr><td><strong>${esc(u.fullName)}</strong><br><span class="muted">${esc(u.email||'—')}</span></td><td>${esc(u.username)}<br><span class="muted">DB#${u.dbId}</span></td><td><span class="pill">${roleMeta[u.role]?.label||u.role}</span></td><td>${statusBadge(u.status)}</td><td><div class="table-actions"><button class="icon-btn" data-edit-user="${u.dbId}" title="Sửa">${icon('edit')}</button><button class="btn btn-sm ${u.status==='active'?'btn-outline':'btn-secondary'}" data-toggle-user="${u.dbId}">${u.status==='active'?'Khóa':'Mở khóa'}</button></div></td></tr>`).join('');
    return `${pageHead('Quản lý người dùng','Tài khoản, vai trò và trạng thái truy cập',actionBtn('Tạo tài khoản','plus','primary','data-add-user'))}${cardTable(['Người dùng','Tên đăng nhập','Vai trò','Trạng thái','Thao tác'],rows,`<div class="toolbar"><input id="userFilter" class="grow" placeholder="Tìm username, email..."><select id="userRoleFilter"><option value="">Tất cả vai trò</option>${Object.entries(roleMeta).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join('')}</select><button class="btn btn-outline btn-sm" data-refresh-users>Làm mới dữ liệu</button></div>`)}`;
  }
  function renderDoctors(){
    const rows=apiDoctors.map(d=>`<tr><td><strong>${esc(d.fullName)}</strong><br><span class="muted">${esc(d.licenseNo||'Chưa có CCHN')} • BS${String(d.dbId).padStart(3,'0')}</span></td><td>${esc(d.specialty)}</td><td>${esc(d.phone||'—')}</td><td>${statusBadge(d.status)}</td><td><div class="table-actions"><button class="icon-btn" data-edit-doctor="${d.dbId}" title="Sửa">${icon('edit')}</button><button class="icon-btn" data-delete-doctor="${d.dbId}" title="Xóa">${icon('close')}</button></div></td></tr>`).join('');
    const specialties=[...new Set(apiDoctors.map(d=>d.specialty).filter(Boolean))];
    const toolbar=`<div class="toolbar"><input id="doctorFilter" class="grow" value="${esc(doctorQuery)}" placeholder="Tìm bác sĩ, chuyên khoa, SĐT, CCHN..."><select id="specialtyFilter"><option value="">Tất cả chuyên khoa</option>${specialties.map(x=>`<option ${doctorSpecialty===x?'selected':''}>${esc(x)}</option>`).join('')}</select><button class="btn btn-outline btn-sm" data-refresh-doctors>Làm mới dữ liệu</button></div>`;
    return `${pageHead('Bác sĩ & chuyên khoa','Danh sách bác sĩ và chuyên khoa',actionBtn('Thêm bác sĩ','plus','primary','data-add-doctor'))}${cardTable(['Bác sĩ','Chuyên khoa','Điện thoại','Trạng thái','Thao tác'],rows,toolbar)}`;
  }

  function renderShifts(){
    const rows=apiShifts.slice().sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start)).map(s=>`<tr><td>${s.id}</td><td><strong>${doctorName(s.doctorId)}</strong></td><td>${fmtDate(s.date)}</td><td>${s.start} – ${s.end}</td><td>${statusBadge(s.status)}</td><td><div class="table-actions"><button class="icon-btn" data-edit-shift="${s.dbId}" title="Sửa">${icon('edit')}</button><button class="icon-btn" data-delete-shift="${s.dbId}" title="Xóa">${icon('close')}</button></div></td></tr>`).join('');
    const toolbar=`<div class="toolbar"><input id="shiftDate" type="date" value="${esc(shiftDateQuery)}"><select id="shiftDoctor"><option value="">Tất cả bác sĩ</option>${apiDoctors.filter(x=>x.status==='active').map(d=>`<option value="${d.id}" ${shiftDoctorQuery===d.id?'selected':''}>${esc(d.fullName)}</option>`).join('')}</select><button class="btn btn-outline btn-sm" data-refresh-shifts>Làm mới dữ liệu</button></div>`;
    return `${pageHead('Quản lý ca làm việc','Theo dõi lịch làm việc của bác sĩ',actionBtn('Thêm ca làm việc','plus','primary','data-add-shift'))}${cardTable(['Mã ca','Bác sĩ','Ngày','Thời gian','Trạng thái','Thao tác'],rows,toolbar)}`;
  }
  function renderReports(){
    const s=reportSummary||{};
    const byStatus=s.appointments_by_status||{};
    return `${pageHead('Thống kê & báo cáo','Số liệu tổng hợp trực tiếp từ PostgreSQL',`<button class="btn btn-outline" data-export-report>${icon('file')}Xuất CSV</button>`)}<div class="toolbar card" style="margin-bottom:18px"><label class="field"><span>Từ ngày</span><input type="date" id="reportFrom"></label><label class="field"><span>Đến ngày</span><input type="date" id="reportTo"></label><button class="btn btn-primary" data-refresh-report>Xem báo cáo</button></div><div class="grid grid-4">${metric('Tổng lượt khám',s.appointments_total||0,'Theo khoảng thời gian')}${metric('Đã hoàn tất',byStatus.completed||0,'Lịch completed')}${metric('Doanh thu',money.format(Number(s.revenue||0)),'Hóa đơn paid')}${metric('Ca bác sĩ',s.shifts_total||0,'Ca làm trong khoảng')}</div><div class="grid grid-2" style="margin-top:18px"><div class="card"><div class="section-title"><div><h3>Trạng thái lịch khám</h3><p>Tổng hợp từ appointments</p></div></div><div class="list">${Object.entries(byStatus).map(([status,n])=>`<div class="list-item"><div class="grow"><strong>${statusLabel(status)}</strong></div><span class="pill">${n}</span></div>`).join('')||'<div class="empty">Chưa có dữ liệu</div>'}</div></div><div class="card"><div class="section-title"><div><h3>Doanh thu theo ngày</h3><p>Hóa đơn đã thanh toán</p></div></div><div class="list">${(s.revenue_by_date||[]).map(x=>`<div class="list-item"><div class="grow"><strong>${fmtDate(x.date)}</strong></div><strong>${money.format(Number(x.revenue||0))}</strong></div>`).join('')||'<div class="empty">Chưa có doanh thu</div>'}</div></div></div>`;
  }

  function renderLogs(){
    const rows=apiLogs.map(l=>`<tr><td>${esc(String(l.created_at||'').replace('T',' ').slice(0,19))}</td><td>${esc(l.username||('User#'+(l.user_id??'—')))}</td><td><span class="pill">${esc(l.action)}</span></td><td>${esc(l.module)}</td><td><code>${esc(l.entity_id??'—')}</code></td><td>${esc(l.details||'')}</td></tr>`).join('');
    return `${pageHead('Nhật ký hệ thống','Nhật ký thật từ bảng system_logs')}${cardTable(['Thời gian','Người dùng','Hành động','Module','Đối tượng','Chi tiết'],rows,`<div class="toolbar"><input id="logFilter" class="grow" value="${esc(logQuery)}" placeholder="Tìm trong nhật ký..."><button class="btn btn-outline btn-sm" data-refresh-logs>Làm mới dữ liệu</button></div>`)}`;
  }

  // --- RECEPTIONIST PAGES ---
  function renderPatients(){
    const rows=apiPatients.map(p=>`<tr><td><strong>${esc(p.fullName)}</strong><br><span class="muted">${p.id}</span></td><td>${fmtDate(p.dob)}</td><td>${esc(p.gender||'—')}</td><td>${esc(p.phone)}</td><td>${esc(p.address||'—')}</td><td><div class="table-actions"><button class="icon-btn" data-view-patient="${p.dbId}" title="Xem">${icon('eye')}</button><button class="icon-btn" data-edit-patient="${p.dbId}" title="Sửa">${icon('edit')}</button><button class="icon-btn" data-delete-patient="${p.dbId}" title="Xóa">${icon('close')}</button></div></td></tr>`).join('');
    const toolbar=`<div class="toolbar"><input id="patientFilter" class="grow" value="${esc(patientQuery)}" placeholder="Mã BN, họ tên, SĐT hoặc địa chỉ..."><select id="patientGender"><option value="" ${!patientGender?'selected':''}>Tất cả giới tính</option><option ${patientGender==='Nam'?'selected':''}>Nam</option><option ${patientGender==='Nữ'?'selected':''}>Nữ</option></select><button class="btn btn-outline btn-sm" data-refresh-patients>Làm mới dữ liệu</button></div>`;
    return `${pageHead('Quản lý bệnh nhân','Theo dõi thông tin bệnh nhân',actionBtn('Thêm bệnh nhân','plus','primary','data-add-patient'))}${cardTable(['Bệnh nhân','Ngày sinh','Giới tính','Điện thoại','Địa chỉ','Thao tác'],rows,toolbar)}`;
  }
  function renderAppointments(){
    const rows=apiAppointments.map(a=>`<tr><td><strong>${a.id}</strong><br><span class="muted">${fmtDate(a.date)} ${a.start}–${a.end}</span></td><td>${patientName(a.patientId)}</td><td>${doctorName(a.doctorId)}</td><td>${esc(a.reason||'—')}</td><td>${statusBadge(a.status)}</td><td><div class="table-actions"><button class="icon-btn" data-view-appt="${a.dbId}" title="Xem">${icon('eye')}</button><button class="icon-btn" data-edit-appt="${a.dbId}" title="Sửa">${icon('edit')}</button>${!['cancelled','completed'].includes(a.status)?`<button class="icon-btn" data-cancel-appt="${a.dbId}" title="Hủy">${icon('close')}</button>`:''}</div></td></tr>`).join('');
    const toolbar=`<div class="toolbar"><input id="apptFilter" class="grow" value="${esc(appointmentQuery)}" placeholder="Bệnh nhân, bác sĩ hoặc lý do khám..."><input id="apptDateFilter" type="date" value="${esc(appointmentDateQuery)}"><select id="apptStatusFilter"><option value="">Tất cả trạng thái</option>${['pending','confirmed','completed','cancelled'].map(s=>`<option value="${s}" ${appointmentStatusQuery===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select><button class="btn btn-outline btn-sm" data-refresh-appointments>Làm mới dữ liệu</button></div>`;
    return `${pageHead('Quản lý lịch khám','Tiếp nhận và theo dõi lịch hẹn khám',actionBtn('Đặt lịch mới','plus','primary','data-add-appt'))}${cardTable(['Lịch khám','Bệnh nhân','Bác sĩ','Lý do','Trạng thái','Thao tác'],rows,toolbar)}`;
  }
  function renderBilling(){ return invoicePage('Lễ tân có thể tra cứu, lập hóa đơn và ghi nhận Tiền mặt/Chuyển khoản.'); }
  function renderSearch(){ return `${pageHead('Tìm kiếm & tra cứu','Tra cứu bệnh nhân và lịch khám theo đúng phạm vi Lễ tân')}<div class="card"><div class="toolbar"><input id="receptionSearch" class="grow" placeholder="Tên/SĐT/mã bệnh nhân, bác sĩ hoặc lý do khám..."><select id="receptionScope"><option value="all">Tất cả</option><option value="patient">Bệnh nhân</option><option value="appointment">Lịch khám</option></select></div><div id="receptionResults" class="card-pad"></div></div>`; }

  // --- DOCTOR PAGES ---
  function myDoctorAppointments(){
    const d=currentDoctor();
    return apiAppointments
      .filter(a=>a.doctorDbId===d?.dbId && a.status!=='cancelled')
      .sort((a,b)=>(a.date+a.start).localeCompare(b.date+b.start));
  }

  function renderDoctorSchedule(){
    const data=myDoctorAppointments().filter(a=>!doctorScheduleDate || a.date===doctorScheduleDate);
    const rows=data.map(a=>`<tr><td>${fmtDate(a.date)}</td><td>${a.start} – ${a.end}</td><td><strong>${patientName(a.patientId)}</strong></td><td>${esc(a.reason||'')}</td><td>${statusBadge(a.status)}</td><td><button class="icon-btn" data-view-appt="${a.dbId}">${icon('eye')}</button></td></tr>`).join('');
    const toolbar=`<div class="toolbar"><label class="field"><span>Ngày khám</span><input id="doctorScheduleDate" type="date" value="${esc(doctorScheduleDate)}"></label><button class="btn btn-outline btn-sm" data-clear-doctor-date>Xóa lọc</button></div>`;
    return `${pageHead('Lịch khám được phân công','Chỉ hiển thị lịch thuộc bác sĩ đang đăng nhập')}${cardTable(['Ngày','Thời gian','Bệnh nhân','Lý do','Trạng thái',''],rows,toolbar)}`;
  }

  function allowedPatientIds(){ return new Set(myDoctorAppointments().map(a=>a.patientId)); }

  function renderRecords(){
    const allowed=allowedPatientIds();
    const keyword=doctorRecordQuery.trim().toLowerCase();
    const pats=apiPatients.filter(p=>allowed.has(p.id)).filter(p=>!keyword || [p.id,p.fullName,p.phone].join(' ').toLowerCase().includes(keyword));
    const rows=pats.map(p=>{
      const aps=myDoctorAppointments().filter(a=>a.patientId===p.id);
      const records=apiMedicalRecords.filter(r=>aps.some(a=>a.dbId===r.appointmentDbId));
      return `<tr><td><strong>${esc(p.fullName)}</strong><br><span class="muted">${p.id}</span></td><td>${esc(p.phone)}</td><td>${aps.length}</td><td>${records.length}</td><td><button class="btn btn-sm btn-outline" data-record-patient="${p.dbId}">${icon('eye')}Xem hồ sơ</button></td></tr>`;
    }).join('');
    const toolbar=`<div class="toolbar"><input id="doctorRecordFilter" class="grow" value="${esc(doctorRecordQuery)}" placeholder="Mã BN, họ tên hoặc SĐT..."></div>`;
    return `${pageHead('Tra cứu hồ sơ bệnh nhân','Chỉ tra cứu hồ sơ bệnh nhân thuộc lịch được phân công')}${cardTable(['Bệnh nhân','Điện thoại','Số lịch liên quan','Phiếu khám',''],rows,toolbar)}`;
  }

  function renderExamination(){
    const eligible=myDoctorAppointments().filter(a=>['confirmed','completed'].includes(a.status));
    return `${pageHead('Khám bệnh','Ghi phiếu khám thật vào bảng medical_records')}<div class="grid grid-3">${eligible.map(a=>{
      const r=apiMedicalRecords.find(x=>x.appointmentDbId===a.dbId);
      return `<div class="card card-pad"><div class="kicker">${a.id} • ${fmtDate(a.date)} ${a.start}</div><h3 style="margin:8px 0 4px">${patientName(a.patientId)}</h3><p class="muted" style="font-size:11px;min-height:34px">${esc(a.reason||'')}</p>${statusBadge(a.status)}<div style="margin-top:15px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-primary btn-sm" data-exam="${a.dbId}">${r?'Cập nhật phiếu khám':'Tạo phiếu khám'}</button>${r?(r.doctorNote?.trim()?`<button class="btn btn-outline btn-sm" data-ai-guidance="${r.dbId}">${icon('bot')}AI hướng dẫn sau khám</button>`:`<button class="btn btn-outline btn-sm" disabled title="Hãy cập nhật Ghi chú bác sĩ trước">${icon('bot')}Cần ghi chú để dùng AI</button>`):''}</div></div>`;
    }).join('')||'<div class="card empty"><strong>Chưa có lịch phù hợp</strong>Lịch cần ở trạng thái Đã xác nhận hoặc Đã khám.</div>'}</div>`;
  }

  function renderPrescription(){
    const eligible=myDoctorAppointments().filter(a=>apiMedicalRecords.some(r=>r.appointmentDbId===a.dbId));
    const rows=eligible.map(a=>{
      const r=apiMedicalRecords.find(x=>x.appointmentDbId===a.dbId);
      return `<tr><td>${a.id}</td><td><strong>${patientName(a.patientId)}</strong></td><td>${fmtDate(a.date)}</td><td>${esc(r?.conclusion||'—')}</td><td>${esc(r?.prescriptionNote||'Chưa có')}</td><td><button class="btn btn-sm btn-outline" data-prescribe="${a.dbId}">${icon('pill')}${r?.prescriptionNote?'Sửa đơn':'Lập đơn'}</button></td></tr>`;
    }).join('');
    return `${pageHead('Lập đơn thuốc','prescription_note được lưu trong medical_records')}${cardTable(['Lịch','Bệnh nhân','Ngày khám','Kết luận','Đơn thuốc',''],rows)}`;
  }

  function renderAISummary(){
    // Chỉ liệt kê bệnh nhân có ít nhất một phiếu khám của bác sĩ hiện tại.
    // Tránh hiển thị bệnh nhân chỉ có lịch hẹn nhưng chưa có dữ liệu để AI tóm tắt.
    const doctorAppointmentIds = new Set(myDoctorAppointments().map(a=>a.dbId));
    const patientIdsWithRecords = new Set(
      apiMedicalRecords
        .filter(r=>doctorAppointmentIds.has(r.appointmentDbId))
        .map(r=>apiAppointments.find(a=>a.dbId===r.appointmentDbId)?.patientId)
        .filter(Boolean)
    );
    const pats=apiPatients.filter(p=>patientIdsWithRecords.has(p.id));
    return `${pageHead('AI tóm tắt hồ sơ khám','KT3 • Backend kiểm tra quyền, giảm PII rồi mới gọi model')}<div class="split"><div class="card"><div class="section-title"><div><h3>Chọn bệnh nhân</h3><p>Chỉ hồ sơ thuộc phạm vi được phép</p></div></div><div class="card-pad"><label class="field"><span>Bệnh nhân</span><select id="aiPatient"><option value="">-- Chọn bệnh nhân --</option>${pats.map(p=>`<option value="${p.id}">${esc(p.fullName)} (${p.id})</option>`).join('')}</select></label><button class="btn btn-primary" id="generateSummary" style="margin-top:14px">${icon('bot')}Tạo bản tóm tắt AI</button></div></div><div class="card ai-panel"><div class="section-title"><div><h3>Kết quả tóm tắt</h3><p>Không phải chẩn đoán</p></div></div><div id="aiSummaryOutput" class="ai-output"><span class="ai-badge">AI • KT3</span><br>Chọn bệnh nhân để backend tạo tóm tắt từ phần hồ sơ bác sĩ được phép xem. Không chẩn đoán.</div></div></div>`;
  }

  // --- ACCOUNTANT PAGES ---
  function renderServices(){
    const rows=apiServices.map(s=>`<tr><td><strong>${s.id}</strong><br><span class="muted">DB#${s.dbId}</span></td><td>${esc(s.name)}</td><td>${money.format(s.unitPrice)}</td><td>${statusBadge(s.status)}</td><td><div class="table-actions"><button class="icon-btn" data-edit-service="${s.dbId}">${icon('edit')}</button><button class="icon-btn" data-delete-service="${s.dbId}">${icon('close')}</button></div></td></tr>`).join('');
    return `${pageHead('Quản lý dịch vụ','Danh mục dịch vụ khám chữa bệnh',actionBtn('Thêm dịch vụ','plus','primary','data-add-service'))}${cardTable(['Mã','Tên dịch vụ','Đơn giá','Trạng thái','Thao tác'],rows,`<div class="toolbar"><input id="serviceFilter" class="grow" placeholder="Tìm dịch vụ..."><button class="btn btn-outline btn-sm" data-refresh-services>Làm mới dữ liệu</button></div>`)}`;
  }

  function invoicePage(note='Quản lý hóa đơn và thanh toán thật trên PostgreSQL.'){
    const rows=apiInvoices.map(i=>`<tr><td><strong>${i.id}</strong><br><span class="muted">${fmtDate(i.invoiceDate)}</span></td><td>${esc(i.patientName||'—')}</td><td>${i.appointmentId||'—'}</td><td>${money.format(i.total)}</td><td>${statusBadge(i.paymentStatus)}</td><td>${esc(i.paymentMethod||'—')}</td><td><div class="table-actions"><button class="icon-btn" data-view-invoice="${i.dbId}">${icon('eye')}</button><button class="icon-btn" data-edit-invoice="${i.dbId}">${icon('edit')}</button></div></td></tr>`).join('');
    return `${pageHead('Hóa đơn & thanh toán',note,actionBtn('Lập hóa đơn','plus','primary','data-new-invoice'))}${cardTable(['Hóa đơn','Bệnh nhân','Lịch khám','Tổng tiền','Thanh toán','Phương thức','Thao tác'],rows,`<div class="toolbar"><input id="invoiceFilter" class="grow" value="${esc(invoiceQuery)}" placeholder="Mã hóa đơn, bệnh nhân/SĐT hoặc lịch khám..."><select id="invoiceStatusFilter"><option value="">Tất cả trạng thái</option><option value="paid" ${invoiceStatusQuery==='paid'?'selected':''}>Đã thanh toán</option><option value="unpaid" ${invoiceStatusQuery==='unpaid'?'selected':''}>Chưa thanh toán</option><option value="cancelled" ${invoiceStatusQuery==='cancelled'?'selected':''}>Đã hủy</option></select><button class="btn btn-outline btn-sm" data-refresh-invoices>Làm mới dữ liệu</button></div>`)}`;
  }

  function renderInvoices(){ return invoicePage(); }

  function renderFinanceReport(){
    const s=reportSummary||{};
    return `${pageHead('Thống kê & báo cáo tài chính','Doanh thu được tổng hợp trực tiếp từ invoices + invoice_items',`<button class="btn btn-outline" data-export-invoice>${icon('file')}Xuất CSV</button>`)}<div class="grid grid-4">${metric('Doanh thu',money.format(Number(s.revenue||0)),'Đã thanh toán')}${metric('Hóa đơn đã thu',s.paid_invoices||0,'Giao dịch paid')}${metric('Hóa đơn chưa thu',s.unpaid_invoices||0,'Cần theo dõi')}${metric('Giá trị TB',money.format(Number(s.average_paid_invoice||0)),'Trên hóa đơn đã thu')}</div><div class="grid grid-2" style="margin-top:18px"><div class="card"><div class="section-title"><div><h3>Doanh thu theo ngày</h3><p>Dữ liệu PostgreSQL</p></div></div><div class="list">${(s.revenue_by_date||[]).map(x=>`<div class="list-item"><div class="grow"><strong>${fmtDate(x.date)}</strong></div><strong>${money.format(Number(x.revenue||0))}</strong></div>`).join('')||'<div class="empty">Chưa có doanh thu</div>'}</div></div><div class="card"><div class="section-title"><div><h3>Dịch vụ sử dụng nhiều</h3><p>Theo hóa đơn paid</p></div></div><div class="list">${(s.service_usage||[]).map(x=>`<div class="list-item"><div class="grow"><strong>${esc(x.service_name)}</strong><small>${money.format(Number(x.amount||0))}</small></div><span class="pill">${x.quantity} lượt</span></div>`).join('')||'<div class="empty">Chưa có dữ liệu dịch vụ</div>'}</div></div></div>`;
  }

  function renderFinanceSearch(){
    return `${pageHead('Tìm kiếm & tra cứu tài chính','Tra cứu hóa đơn và dịch vụ từ dữ liệu đã tải qua API')}<div class="card"><div class="toolbar"><input id="financeSearch" class="grow" placeholder="Mã hóa đơn, bệnh nhân/SĐT, thanh toán hoặc dịch vụ..."><select id="financeScope"><option value="all">Tất cả</option><option value="invoice">Hóa đơn</option><option value="service">Dịch vụ</option></select></div><div id="financeResults" class="card-pad"></div></div>`;
  }

  // --- PATIENT PAGES ---
  function renderProfile(){
    const p=currentPatient(),u=currentUser();
    return `${pageHead('Tài khoản cá nhân','Thông tin cá nhân của bệnh nhân')}<div class="grid grid-2"><div class="card card-pad"><div class="profile-card"><div class="profile-avatar">${initials(p?.fullName||u.fullName)}</div><div><h3>${esc(p?.fullName||u.fullName)}</h3><p>${esc(u.email||'')} • ${esc(p?.phone||'')}</p></div></div><div class="divider"><span>Thông tin</span></div><div class="list"><div class="list-item"><div class="grow"><strong>Mã bệnh nhân</strong><small>${p?.id||'Chưa liên kết'}</small></div></div><div class="list-item"><div class="grow"><strong>Ngày sinh</strong><small>${fmtDate(p?.dob)}</small></div></div><div class="list-item"><div class="grow"><strong>Giới tính</strong><small>${esc(p?.gender||'—')}</small></div></div><div class="list-item"><div class="grow"><strong>Địa chỉ</strong><small>${esc(p?.address||'—')}</small></div></div></div></div><div class="card card-pad"><h3 style="margin-top:0">Cập nhật thông tin</h3><form id="profileForm" class="form-grid"><label class="field full"><span>Họ và tên</span><input name="fullName" value="${esc(p?.fullName||'')}"></label><label class="field"><span>Ngày sinh</span><input name="dob" type="date" value="${p?.dob||''}"></label><label class="field"><span>Giới tính</span><select name="gender"><option ${p?.gender==='Nam'?'selected':''}>Nam</option><option ${p?.gender==='Nữ'?'selected':''}>Nữ</option></select></label><label class="field"><span>Điện thoại</span><input name="phone" value="${esc(p?.phone||'')}"></label><label class="field"><span>Email</span><input name="email" value="${esc(u.email||'')}"></label><label class="field full"><span>Địa chỉ</span><input name="address" value="${esc(p?.address||'')}"></label><div class="field full"><button class="btn btn-primary">Lưu thay đổi</button></div></form></div></div>`;
  }

  function renderBooking(){
    return `${pageHead('Đặt lịch khám','Đăng ký lịch khám theo nhu cầu của bạn')}<div class="grid grid-2"><div class="card card-pad"><form id="bookingForm" class="form-grid"><label class="field full required"><span>Bác sĩ</span><select name="doctorId" required><option value="">-- Chọn bác sĩ --</option>${apiDoctors.filter(d=>d.status==='active').map(d=>`<option value="${d.dbId}">${esc(d.fullName)} • ${esc(d.specialty)}</option>`).join('')}</select></label><label class="field required"><span>Ngày khám</span><input name="date" type="date" value="${today()}" required></label><label class="field required"><span>Giờ bắt đầu</span><input name="start" type="time" value="08:00" required></label><label class="field full required"><span>Lý do khám</span><textarea name="reason" required placeholder="Mô tả ngắn nhu cầu khám..."></textarea></label><div class="field full"><button class="btn btn-primary">${icon('calendar')}Kiểm tra và đặt lịch</button></div></form></div><div class="card"><div class="section-title"><div><h3>Ca làm việc hiện có</h3><p>Dữ liệu từ PostgreSQL</p></div></div><div class="list">${apiShifts.filter(s=>s.status==='active').slice(0,20).map(s=>`<div class="list-item"><span class="avatar">${s.start.slice(0,2)}</span><div class="grow"><strong>${doctorName(s.doctorId)}</strong><small>${fmtDate(s.date)} • ${s.start} – ${s.end}</small></div></div>`).join('')||'<div class="empty">Chưa có ca làm hoạt động.</div>'}</div></div></div>`;
  }

  function renderMyAppointments(){
    const p=currentPatient();
    const mine=apiAppointments.filter(a=>a.patientDbId===p?.dbId).sort((a,b)=>(b.date+b.start).localeCompare(a.date+a.start));
    const rows=mine.map(a=>`<tr><td><strong>${a.id}</strong><br><span class="muted">${fmtDate(a.date)} ${a.start}</span></td><td>${doctorName(a.doctorId)}<br><span class="muted">${apiDoctors.find(d=>d.id===a.doctorId)?.specialty||''}</span></td><td>${esc(a.reason||'')}</td><td>${statusBadge(a.status)}</td><td><div class="table-actions"><button class="icon-btn" data-view-appt="${a.dbId}">${icon('eye')}</button>${!['completed','cancelled'].includes(a.status)?`<button class="btn btn-sm btn-outline" data-patient-reschedule="${a.dbId}">Đổi lịch</button><button class="btn btn-sm btn-outline" data-patient-cancel="${a.dbId}">Hủy</button>`:''}</div></td></tr>`).join('');
    return `${pageHead('Lịch khám của tôi','Theo dõi các lịch khám đã đăng ký',actionBtn('Đặt lịch mới','plus','primary','data-go="booking"'))}${cardTable(['Lịch khám','Bác sĩ','Lý do','Trạng thái','Thao tác'],rows)}`;
  }

  function renderChatbot(){ return `${pageHead('Chatbot hỏi đáp quy trình','Hỗ trợ hành chính về đặt lịch, chuẩn bị khám và thanh toán')}<div class="grid grid-2"><div class="card chat"><div class="section-title"><div><h3>MediFlow Assistant</h3><p>KT3 • AI qua backend FastAPI</p></div></div><div id="chatMessages" class="chat-messages"><div class="chat-msg bot">Xin chào! Tôi có thể hỗ trợ bạn về <strong>đặt lịch</strong>, <strong>chuẩn bị trước khi khám</strong> và <strong>thanh toán</strong>. Tôi không đưa ra chẩn đoán y khoa.</div></div><form id="chatForm" class="chat-input"><input id="chatInput" placeholder="Ví dụ: Tôi cần chuẩn bị gì trước khi khám?"><button class="btn btn-primary">Gửi</button></form></div><div class="card card-pad"><h3 style="margin-top:0">Câu hỏi gợi ý</h3><div class="list">${['Cách đặt lịch khám như thế nào?','Tôi cần chuẩn bị giấy tờ gì?','Có thể đổi hoặc hủy lịch không?','Thanh toán bằng hình thức nào?','Tôi có thể xem hướng dẫn sau khám ở đâu?'].map(q=>`<button class="list-item quick-question" data-q="${esc(q)}" style="border:0;background:transparent;text-align:left;width:100%"><div class="grow"><strong>${q}</strong><small>Nhấn để gửi câu hỏi</small></div></button>`).join('')}</div><div class="info-banner warning-banner" style="margin-top:15px"><div><strong>Giới hạn hỗ trợ</strong><br>Chatbot sẽ từ chối các câu hỏi yêu cầu chẩn đoán, kê thuốc hoặc thay thế quyết định của bác sĩ.</div></div></div></div>`; }
  function renderGuidance(){
    const records=(patientGuidanceData?.records||[]).map(medicalRecordFromApi);
    return `${pageHead('Hướng dẫn sau khám','Theo dõi dặn dò của bác sĩ sau mỗi lần khám')}<div class="grid grid-2">${records.map(r=>`<div class="card"><div class="section-title"><div><h3>${fmtDate(r.appointmentDate)} • ${esc(r.doctorName)}</h3><p>${r.appointmentId}</p></div></div><div class="card-pad"><div class="kicker">Kết luận</div><p style="font-size:12px;line-height:1.6">${esc(r.conclusion||'Chưa có')}</p><div class="kicker" style="margin-top:15px">Hướng dẫn sau khám</div><p style="font-size:12px;line-height:1.7">${esc(r.postVisitGuidance||'Chưa có nội dung hướng dẫn sau khám.')}</p></div></div>`).join('')||'<div class="card empty"><strong>Chưa có hướng dẫn</strong>Không có nội dung hướng dẫn sau khám phù hợp với tài khoản hiện tại.</div>'}</div>`;
  }

  const routes={dashboard:renderDashboard,users:renderUsers,doctors:renderDoctors,shifts:renderShifts,reports:renderReports,logs:renderLogs,patients:renderPatients,appointments:renderAppointments,billing:renderBilling,search:renderSearch,'doctor-schedule':renderDoctorSchedule,records:renderRecords,examination:renderExamination,prescription:renderPrescription,'ai-summary':renderAISummary,services:renderServices,invoices:renderInvoices,'finance-report':renderFinanceReport,'finance-search':renderFinanceSearch,profile:renderProfile,booking:renderBooking,'my-appointments':renderMyAppointments,chatbot:renderChatbot,guidance:renderGuidance};

  // --- MODAL HELPERS ---
  function openModal(title,subtitle,body,footer='',wide=false){ byId('modalTitle').textContent=title;byId('modalSubtitle').textContent=subtitle||'';byId('modalBody').innerHTML=body;byId('modalFooter').innerHTML=footer;byId('modal').classList.toggle('wide',wide);byId('modalBackdrop').classList.remove('hidden'); }
  function closeModal(){ byId('modalBackdrop').classList.add('hidden');byId('modalBody').innerHTML='';byId('modalFooter').innerHTML=''; }
  function formData(form){ return Object.fromEntries(new FormData(form).entries()); }
  function bindCommon(){
    byId('content').querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.go)));
  }

  function userForm(u={}){ const roles=Object.entries(roleMeta).filter(([k])=>k!=='patient'||u.role==='patient'); return `<form id="entityForm" class="form-grid"><label class="field full required"><span>Tên đăng nhập</span><input name="username" required minlength="3" value="${esc(u.username||'')}"></label><label class="field full ${u.dbId?'':'required'}"><span>Mật khẩu ${u.dbId?'(để trống nếu không đổi)':''}</span><input name="password" type="password" minlength="6" ${u.dbId?'':'required'} value=""></label><label class="field full"><span>Email</span><input name="email" type="email" value="${esc(u.email||'')}"></label><label class="field required"><span>Vai trò</span><select name="role">${roles.map(([k,v])=>`<option value="${k}" ${u.role===k?'selected':''}>${v.label}</option>`).join('')}</select><small>Bệnh nhân tự đăng ký từ màn hình đăng nhập.</small></label><label class="field required"><span>Trạng thái</span><select name="status"><option value="active" ${u.status!=='locked'?'selected':''}>Hoạt động</option><option value="locked" ${u.status==='locked'?'selected':''}>Bị khóa</option></select></label></form>`; }
  function patientForm(p={}){ return `<form id="entityForm" class="form-grid"><label class="field full required"><span>Họ và tên</span><input name="fullName" required value="${esc(p.fullName||'')}"></label><label class="field required"><span>Ngày sinh</span><input type="date" name="dob" required value="${p.dob||''}"></label><label class="field required"><span>Giới tính</span><select name="gender"><option ${p.gender==='Nam'?'selected':''}>Nam</option><option ${p.gender==='Nữ'?'selected':''}>Nữ</option></select></label><label class="field required"><span>Điện thoại</span><input name="phone" required pattern="0[0-9]{9}" value="${esc(p.phone||'')}"><small>10 chữ số, bắt đầu bằng 0</small></label><label class="field full"><span>Địa chỉ</span><input name="address" value="${esc(p.address||'')}"></label></form>`; }
  function doctorForm(d={}){ return `<form id="entityForm" class="form-grid"><label class="field full required"><span>Họ tên bác sĩ</span><input name="fullName" required value="${esc(d.fullName||'')}"></label><label class="field required"><span>Chuyên khoa</span><input name="specialty" required value="${esc(d.specialty||'')}"></label><label class="field required"><span>Số điện thoại</span><input name="phone" required value="${esc(d.phone||'')}"></label><label class="field required"><span>Số CCHN</span><input name="licenseNo" required value="${esc(d.licenseNo||'')}"></label><label class="field"><span>Trạng thái</span><select name="status"><option value="active" ${d.status!=='inactive'?'selected':''}>Hoạt động</option><option value="inactive" ${d.status==='inactive'?'selected':''}>Ngừng hoạt động</option></select></label></form>`; }
  function shiftForm(s={}){ return `<form id="entityForm" class="form-grid"><label class="field full required"><span>Bác sĩ</span><select name="doctorId" required>${apiDoctors.filter(d=>d.status==='active'||d.id===s.doctorId).map(d=>`<option value="${d.id}" ${s.doctorId===d.id?'selected':''}>${esc(d.fullName)} • ${esc(d.specialty)}</option>`).join('')}</select></label><label class="field required"><span>Ngày</span><input name="date" type="date" required value="${s.date||today()}"></label><label class="field required"><span>Trạng thái</span><select name="status"><option value="active" ${s.status!=='inactive'?'selected':''}>Hoạt động</option><option value="inactive" ${s.status==='inactive'?'selected':''}>Ngừng</option></select></label><label class="field required"><span>Bắt đầu</span><input name="start" type="time" required value="${s.start||'08:00'}"></label><label class="field required"><span>Kết thúc</span><input name="end" type="time" required value="${s.end||'12:00'}"></label></form>`; }
  function appointmentForm(a={}, patientFixed=false){ const defaultPatient=patientFixed?currentPatient()?.id:(a.patientId||'');const pats=apiPatients.length?apiPatients:state.patients;const docs=apiDoctors.length?apiDoctors:state.doctors;return `<form id="entityForm" class="form-grid"><label class="field full required"><span>Bệnh nhân</span><select name="patientId" required ${patientFixed?'disabled':''}>${pats.map(p=>`<option value="${p.id}" ${(defaultPatient===p.id)?'selected':''}>${esc(p.fullName)} (${p.id})</option>`).join('')}</select>${patientFixed?`<input type="hidden" name="patientId" value="${defaultPatient}">`:''}</label><label class="field full required"><span>Bác sĩ</span><select name="doctorId" required ${patientFixed?'disabled':''}>${docs.filter(d=>d.status==='active').map(d=>`<option value="${d.id}" ${a.doctorId===d.id?'selected':''}>${esc(d.fullName)} • ${esc(d.specialty)}</option>`).join('')}</select>${patientFixed?`<input type="hidden" name="doctorId" value="${a.doctorId||''}">`:''}</label><label class="field required"><span>Ngày khám</span><input type="date" name="date" required value="${a.date||today()}"></label><label class="field required"><span>Giờ bắt đầu</span><input type="time" name="start" required value="${a.start||'10:00'}"></label><label class="field full required"><span>Lý do khám</span><textarea name="reason" required ${patientFixed?'readonly':''}>${esc(a.reason||'')}</textarea></label>${patientFixed?`<input type="hidden" name="status" value="${a.status||'pending'}">`:`<label class="field"><span>Trạng thái</span><select name="status">${['pending','confirmed','completed','cancelled'].map(s=>`<option value="${s}" ${a.status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></label>`}</form>`; }
  function serviceForm(s={}){ return `<form id="entityForm" class="form-grid"><label class="field full required"><span>Tên dịch vụ</span><input name="name" required value="${esc(s.name||'')}"></label><label class="field required"><span>Đơn giá</span><input type="number" min="0" step="1000" name="unitPrice" required value="${s.unitPrice||''}"></label><label class="field"><span>Trạng thái</span><select name="status"><option value="active" ${s.status!=='inactive'?'selected':''}>Hoạt động</option><option value="inactive" ${s.status==='inactive'?'selected':''}>Ngừng</option></select></label></form>`; }
  function examinationForm(a,r={}){ return `<form id="entityForm" class="form-grid"><div class="field full"><div class="info-banner"><div><strong>${patientName(a.patientId)}</strong> • ${a.id} • ${fmtDate(a.date)} ${a.start}<br>${esc(a.reason)}</div></div></div><label class="field full required"><span>Triệu chứng</span><textarea name="symptoms" required>${esc(r.symptoms||'')}</textarea></label><label class="field full required"><span>Kết luận khám</span><textarea name="conclusion" required>${esc(r.conclusion||'')}</textarea></label><label class="field full"><span>Ghi chú bác sĩ</span><textarea name="doctorNote">${esc(r.doctorNote||'')}</textarea></label><label class="field full"><span>Hướng dẫn sau khám</span><textarea name="postVisitGuidance">${esc(r.postVisitGuidance||'')}</textarea><small>Có thể nhập thủ công; sau khi lưu phiếu khám, Bác sĩ có thể dùng AI KT3 để sinh hướng dẫn từ ghi chú đã lưu.</small></label></form>`; }

  function calcEnd(start){ const [h,m]=start.split(':').map(Number);const d=new Date(2000,0,1,h,m+30);return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
  function overlaps(aStart,aEnd,bStart,bEnd){ return aStart < bEnd && bStart < aEnd; }
  function validateAppointment(data, excludeId=''){
    const end=calcEnd(data.start); const conflict=state.appointments.find(a=>a.id!==excludeId && a.doctorId===data.doctorId && a.date===data.date && a.status!=='cancelled' && overlaps(data.start,end,a.start,a.end));
    if(conflict) return `Khung giờ bị trùng với ${conflict.id} (${conflict.start}–${conflict.end}, ${patientName(conflict.patientId)}).`;
    const shiftSource=apiShifts.length?apiShifts:state.shifts;
    const shifts=shiftSource.filter(s=>s.doctorId===data.doctorId&&s.date===data.date&&s.status==='active');
    if(shifts.length && !shifts.some(s=>data.start>=s.start&&end<=s.end)) return 'Thời gian đã chọn nằm ngoài ca làm việc của bác sĩ.';
    return '';
  }

  function openUserModal(dbId){
    const u=dbId?apiUsers.find(x=>x.dbId===Number(dbId)):null;
    openModal(u?'Cập nhật tài khoản':'Tạo tài khoản',u?'Cập nhật tài khoản thật trong PostgreSQL':'Tạo tài khoản đăng nhập thật',userForm(u||{}),`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-user>${u?'Lưu thay đổi':'Tạo tài khoản'}</button>`);
    bindModalCancel();
    byId('modalFooter').querySelector('[data-save-user]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const d=formData(f);
      const payload={username:d.username,email:d.email||null,role:d.role,status:d.status};
      if(d.password) payload.password=d.password;
      const btn=byId('modalFooter').querySelector('[data-save-user]');
      btn.disabled=true;
      try{
        await apiRequest(u?`/users/${u.dbId}`:'/users',{method:u?'PUT':'POST',body:JSON.stringify(payload)});
        closeModal();
        toast('Đã lưu tài khoản','Dữ liệu đã được cập nhật trong PostgreSQL');
        await refreshUsersPage();
      }catch(err){
        toast('Không thể lưu tài khoản',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  async function refreshUsersPage(){
    try{
      await loadApiUsers();
      if(currentRoute!=='users') return;
      byId('content').innerHTML=renderUsers();
      bindCommon();
      bindUsersPage();
    }catch(err){
      if(currentRoute==='users') toast('Không tải được Users API',err.message,'error');
    }
  }

  function bindUsersPage(){
    const root=byId('content');
    root.querySelector('[data-add-user]')?.addEventListener('click',()=>openUserModal());
    root.querySelectorAll('[data-edit-user]').forEach(b=>b.onclick=()=>openUserModal(b.dataset.editUser));
    root.querySelectorAll('[data-toggle-user]').forEach(b=>b.onclick=async()=>{
      const u=apiUsers.find(x=>x.dbId===Number(b.dataset.toggleUser));
      if(!u) return;
      if(u.dbId===currentUser().dbId){
        toast('Không thể khóa tài khoản hiện tại','','error');
        return;
      }
      try{
        await apiRequest(`/users/${u.dbId}`,{method:'PUT',body:JSON.stringify({status:u.status==='active'?'locked':'active'})});
        await refreshUsersPage();
        toast('Đã cập nhật trạng thái tài khoản');
      }catch(err){ toast('Không thể cập nhật',err.message,'error'); }
    });
    root.querySelector('[data-refresh-users]')?.addEventListener('click',()=>refreshUsersPage());
    const roleFilter=byId('userRoleFilter');
    const run=bindTableFilter('userFilter',tr=>tr.innerText,tr=>!roleFilter.value||tr.children[2].innerText===roleMeta[roleFilter.value].label);
    if(roleFilter) roleFilter.onchange=run;
  }
  function openPatientModal(dbId){
    const p=dbId?apiPatients.find(x=>x.dbId===Number(dbId)):null;
    openModal(p?'Cập nhật bệnh nhân':'Thêm bệnh nhân','Dữ liệu sẽ lưu trực tiếp vào PostgreSQL',patientForm(p||{}),`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-patient>Lưu hồ sơ</button>`);
    bindModalCancel();

    byId('modalFooter').querySelector('[data-save-patient]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const d=formData(f);
      const payload={
        user_id: p?.userId ?? null,
        full_name: d.fullName,
        date_of_birth: d.dob || null,
        gender: d.gender || null,
        phone: d.phone,
        address: d.address || null
      };
      const saveBtn=byId('modalFooter').querySelector('[data-save-patient]');
      saveBtn.disabled=true;
      try{
        await apiRequest(p?`/patients/${p.dbId}`:'/patients',{
          method:p?'PUT':'POST',
          body:JSON.stringify(payload)
        });
        closeModal();
        toast(p?'Đã cập nhật bệnh nhân':'Đã thêm bệnh nhân','Dữ liệu đã lưu vào PostgreSQL');
        await refreshPatientsPage();
      }catch(err){
        toast('Không thể lưu bệnh nhân',err.message,'error');
        saveBtn.disabled=false;
      }
    };
  }

  async function deletePatient(dbId){
    const p=apiPatients.find(x=>x.dbId===Number(dbId));
    if(!p) return;
    if(!window.confirm(`Xóa hồ sơ ${p.fullName} (${p.id})?`)) return;
    try{
      await apiRequest(`/patients/${p.dbId}`,{method:'DELETE'});
      toast('Đã xóa bệnh nhân','Dữ liệu đã được xóa khỏi PostgreSQL');
      await refreshPatientsPage();
    }catch(err){
      toast('Không thể xóa bệnh nhân',err.message,'error');
    }
  }

  async function refreshPatientsPage(){
    try{
      await loadApiPatients();
      if(currentRoute!=='patients') return;
      byId('content').innerHTML=renderPatients();
      bindCommon();
      bindPatientControls();
    }catch(err){
      if(currentRoute==='patients'){
        toast('Không kết nối được Patients API',`${err.message} Hãy kiểm tra FastAPI đang chạy ở 127.0.0.1:8000.`,'error');
      }
    }
  }

  function bindPatientControls(){
    const root=byId('content');
    root.querySelector('[data-add-patient]')?.addEventListener('click',()=>openPatientModal());
    root.querySelectorAll('[data-edit-patient]').forEach(b=>b.onclick=()=>openPatientModal(b.dataset.editPatient));
    root.querySelectorAll('[data-view-patient]').forEach(b=>b.onclick=()=>viewPatient(b.dataset.viewPatient));
    root.querySelectorAll('[data-delete-patient]').forEach(b=>b.onclick=()=>deletePatient(b.dataset.deletePatient));
    root.querySelector('[data-refresh-patients]')?.addEventListener('click',()=>refreshPatientsPage());

    const q=byId('patientFilter');
    const gender=byId('patientGender');
    if(q){
      q.addEventListener('input',debounce(()=>{
        patientQuery=q.value;
        refreshPatientsPage();
      },350));
    }
    if(gender){
      gender.onchange=()=>{
        patientGender=gender.value;
        refreshPatientsPage();
      };
    }
  }

  function openDoctorModal(dbId){
    const d=dbId?apiDoctors.find(x=>x.dbId===Number(dbId)):null;
    openModal(d?'Cập nhật bác sĩ':'Thêm bác sĩ','Dữ liệu sẽ lưu trực tiếp vào PostgreSQL',doctorForm(d||{}),`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-doctor>Lưu</button>`);
    bindModalCancel();

    byId('modalFooter').querySelector('[data-save-doctor]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const x=formData(f);
      const payload={
        full_name:x.fullName,
        specialty:x.specialty,
        phone:x.phone||null,
        license_no:x.licenseNo||null,
        status:x.status
      };
      const btn=byId('modalFooter').querySelector('[data-save-doctor]');
      btn.disabled=true;
      try{
        await apiRequest(d?`/doctors/${d.dbId}`:'/doctors',{
          method:d?'PUT':'POST',
          body:JSON.stringify(payload)
        });
        closeModal();
        toast(d?'Đã cập nhật bác sĩ':'Đã thêm bác sĩ','Dữ liệu đã lưu vào PostgreSQL');
        await refreshDoctorsPage();
      }catch(err){
        toast('Không thể lưu bác sĩ',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  async function deleteDoctor(dbId){
    const d=apiDoctors.find(x=>x.dbId===Number(dbId));
    if(!d) return;
    if(!window.confirm(`Xóa bác sĩ ${d.fullName} (${d.id})? Các ca làm của bác sĩ này cũng sẽ bị xóa.`)) return;
    try{
      await apiRequest(`/doctors/${d.dbId}`,{method:'DELETE'});
      toast('Đã xóa bác sĩ','Dữ liệu đã được xóa khỏi PostgreSQL');
      await Promise.all([loadApiDoctors(),loadApiShifts()]);
      if(currentRoute==='doctors'){
        byId('content').innerHTML=renderDoctors();
        bindCommon();
        bindDoctorControls();
      }
    }catch(err){
      toast('Không thể xóa bác sĩ',err.message,'error');
    }
  }

  async function refreshDoctorsPage(){
    try{
      await loadApiDoctors();
      if(currentRoute!=='doctors') return;
      byId('content').innerHTML=renderDoctors();
      bindCommon();
      bindDoctorControls();
    }catch(err){
      if(currentRoute==='doctors') toast('Không kết nối được Doctors API',err.message,'error');
    }
  }

  function bindDoctorControls(){
    const root=byId('content');
    root.querySelector('[data-add-doctor]')?.addEventListener('click',()=>openDoctorModal());
    root.querySelectorAll('[data-edit-doctor]').forEach(b=>b.onclick=()=>openDoctorModal(b.dataset.editDoctor));
    root.querySelectorAll('[data-delete-doctor]').forEach(b=>b.onclick=()=>deleteDoctor(b.dataset.deleteDoctor));
    root.querySelector('[data-refresh-doctors]')?.addEventListener('click',()=>refreshDoctorsPage());

    const q=byId('doctorFilter');
    const specialty=byId('specialtyFilter');
    if(q){
      q.addEventListener('input',debounce(()=>{
        doctorQuery=q.value;
        refreshDoctorsPage();
      },350));
    }
    if(specialty){
      specialty.onchange=()=>{
        doctorSpecialty=specialty.value;
        refreshDoctorsPage();
      };
    }
  }

  function openShiftModal(dbId){
    const s=dbId?apiShifts.find(x=>x.dbId===Number(dbId)):null;
    if(!apiDoctors.some(d=>d.status==='active'||d.id===s?.doctorId)){
      toast('Chưa có bác sĩ hoạt động','Hãy tạo bác sĩ trước khi tạo ca làm việc.','error');
      return;
    }
    openModal(s?'Cập nhật ca làm việc':'Thêm ca làm việc','Ca làm được lưu trực tiếp vào PostgreSQL',shiftForm(s||{}),`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-shift>Lưu ca</button>`);
    bindModalCancel();

    byId('modalFooter').querySelector('[data-save-shift]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const x=formData(f);
      if(x.start>=x.end){
        toast('Thời gian không hợp lệ','Giờ kết thúc phải sau giờ bắt đầu','error');
        return;
      }
      const doctor=apiDoctors.find(d=>d.id===x.doctorId);
      if(!doctor){
        toast('Không tìm thấy bác sĩ','','error');
        return;
      }
      const payload={
        doctor_id:doctor.dbId,
        shift_date:x.date,
        start_time:x.start,
        end_time:x.end,
        status:x.status
      };
      const btn=byId('modalFooter').querySelector('[data-save-shift]');
      btn.disabled=true;
      try{
        await apiRequest(s?`/shifts/${s.dbId}`:'/shifts',{
          method:s?'PUT':'POST',
          body:JSON.stringify(payload)
        });
        closeModal();
        toast(s?'Đã cập nhật ca làm':'Đã thêm ca làm','Dữ liệu đã lưu vào PostgreSQL');
        await refreshShiftsPage();
      }catch(err){
        toast('Không thể lưu ca làm',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  async function deleteShift(dbId){
    const s=apiShifts.find(x=>x.dbId===Number(dbId));
    if(!s) return;
    if(!window.confirm(`Xóa ${s.id} của ${doctorName(s.doctorId)}?`)) return;
    try{
      await apiRequest(`/shifts/${s.dbId}`,{method:'DELETE'});
      toast('Đã xóa ca làm việc','Dữ liệu đã được xóa khỏi PostgreSQL');
      await refreshShiftsPage();
    }catch(err){
      toast('Không thể xóa ca làm',err.message,'error');
    }
  }

  async function refreshShiftsPage(){
    try{
      if(!apiDoctors.length) await loadApiDoctors();
      await loadApiShifts();
      if(currentRoute!=='shifts') return;
      byId('content').innerHTML=renderShifts();
      bindCommon();
      bindShiftControls();
    }catch(err){
      if(currentRoute==='shifts') toast('Không kết nối được Shifts API',err.message,'error');
    }
  }

  function bindShiftControls(){
    const root=byId('content');
    root.querySelector('[data-add-shift]')?.addEventListener('click',()=>openShiftModal());
    root.querySelectorAll('[data-edit-shift]').forEach(b=>b.onclick=()=>openShiftModal(b.dataset.editShift));
    root.querySelectorAll('[data-delete-shift]').forEach(b=>b.onclick=()=>deleteShift(b.dataset.deleteShift));
    root.querySelector('[data-refresh-shifts]')?.addEventListener('click',()=>refreshShiftsPage());

    const dateInput=byId('shiftDate');
    const doctorSelect=byId('shiftDoctor');
    if(dateInput){
      dateInput.onchange=()=>{
        shiftDateQuery=dateInput.value;
        refreshShiftsPage();
      };
    }
    if(doctorSelect){
      doctorSelect.onchange=()=>{
        shiftDoctorQuery=doctorSelect.value;
        refreshShiftsPage();
      };
    }
  }

  async function openAppointmentModal(dbId,patientFixed=false){
    try{
      await loadAppointmentReferences();
      await loadApiAppointments();
    }catch(err){
      toast('Không tải được dữ liệu đặt lịch',err.message,'error');
      return;
    }

    const a=dbId?apiAppointments.find(x=>x.dbId===Number(dbId)):null;

    if(!apiPatients.length){
      toast('Chưa có bệnh nhân','Hãy thêm bệnh nhân trước khi tạo lịch.','error');
      return;
    }
    if(!apiDoctors.some(d=>d.status==='active')){
      toast('Chưa có bác sĩ hoạt động','Hãy thêm bác sĩ trước khi tạo lịch.','error');
      return;
    }

    openModal(
      a?'Cập nhật lịch khám':'Đặt lịch khám',
      'Dữ liệu sẽ lưu trực tiếp vào PostgreSQL',
      appointmentForm(a||{},patientFixed),
      `<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-appt>${a?'Lưu thay đổi':'Đặt lịch'}</button>`
    );
    bindModalCancel();

    byId('modalFooter').querySelector('[data-save-appt]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;

      const x=formData(f);
      const patient=apiPatients.find(p=>p.id===x.patientId);
      const doctor=apiDoctors.find(d=>d.id===x.doctorId);

      if(!patient || !doctor){
        toast('Dữ liệu không hợp lệ','Không tìm thấy bệnh nhân hoặc bác sĩ trong PostgreSQL.','error');
        return;
      }

      const payload={
        patient_id:patient.dbId,
        doctor_id:doctor.dbId,
        appointment_date:x.date,
        start_time:x.start,
        end_time:calcEnd(x.start),
        reason:x.reason||null,
        status:x.status||'pending'
      };

      const btn=byId('modalFooter').querySelector('[data-save-appt]');
      btn.disabled=true;

      try{
        await apiRequest(a?`/appointments/${a.dbId}`:'/appointments',{
          method:a?'PUT':'POST',
          body:JSON.stringify(payload)
        });
        closeModal();
        toast(a?'Đã cập nhật lịch':'Đặt lịch thành công','Dữ liệu đã được lưu vào PostgreSQL');
        await refreshAppointmentsPage();
      }catch(err){
        toast('Không thể ghi nhận lịch',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  function openServiceModal(dbId){
    const s=dbId?apiServices.find(x=>x.dbId===Number(dbId)):null;
    openModal(s?'Cập nhật dịch vụ':'Thêm dịch vụ','Dữ liệu sẽ lưu trực tiếp vào PostgreSQL',serviceForm(s||{}),`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-service>Lưu</button>`);
    bindModalCancel();
    byId('modalFooter').querySelector('[data-save-service]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const x=formData(f);
      const payload={name:x.name,unit_price:Number(x.unitPrice),status:x.status};
      const btn=byId('modalFooter').querySelector('[data-save-service]');
      btn.disabled=true;
      try{
        await apiRequest(s?`/services/${s.dbId}`:'/services',{method:s?'PUT':'POST',body:JSON.stringify(payload)});
        closeModal();
        toast('Đã lưu dịch vụ','Dữ liệu đã được cập nhật trong PostgreSQL');
        await refreshServicesPage();
      }catch(err){
        toast('Không thể lưu dịch vụ',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  async function deleteService(dbId){
    const s=apiServices.find(x=>x.dbId===Number(dbId));
    if(!s) return;
    if(!window.confirm(`Xóa dịch vụ ${s.name}?`)) return;
    try{
      await apiRequest(`/services/${s.dbId}`,{method:'DELETE'});
      toast('Đã xóa dịch vụ');
      await refreshServicesPage();
    }catch(err){
      toast('Không thể xóa dịch vụ',err.message,'error');
    }
  }

  async function refreshServicesPage(){
    try{
      await loadApiServices();
      if(currentRoute!=='services') return;
      byId('content').innerHTML=renderServices();
      bindCommon();
      bindServicePage();
    }catch(err){
      if(currentRoute==='services') toast('Không tải được Services API',err.message,'error');
    }
  }

  function bindServicePage(){
    const root=byId('content');
    root.querySelector('[data-add-service]')?.addEventListener('click',()=>openServiceModal());
    root.querySelectorAll('[data-edit-service]').forEach(b=>b.onclick=()=>openServiceModal(b.dataset.editService));
    root.querySelectorAll('[data-delete-service]').forEach(b=>b.onclick=()=>deleteService(b.dataset.deleteService));
    root.querySelector('[data-refresh-services]')?.addEventListener('click',()=>refreshServicesPage());
    bindTableFilter('serviceFilter',tr=>tr.innerText);
  }

  function bindModalCancel(){ byId('modalFooter').querySelector('[data-modal-cancel]')?.addEventListener('click',closeModal); }

  function viewPatient(dbId){
    const p=apiPatients.find(x=>x.dbId===Number(dbId));
    if(!p){ toast('Không tìm thấy bệnh nhân','','error'); return; }
    openModal('Hồ sơ bệnh nhân',`${p.id} • ${p.phone}`,`<div class="profile-card"><div class="profile-avatar">${initials(p.fullName)}</div><div><h3>${esc(p.fullName)}</h3><p>${fmtDate(p.dob)} • ${esc(p.gender||'—')} • ${esc(p.address||'—')}</p></div></div><div class="divider"><span>Dữ liệu</span></div><div class="notice-card"><p><strong>ID PostgreSQL:</strong> ${p.dbId}<br><strong>Số điện thoại:</strong> ${esc(p.phone)}<br><strong>Liên kết tài khoản:</strong> ${p.userId??'Chưa liên kết'}</p></div><div class="info-banner" style="margin-top:12px">${icon('calendar')}<div>Lịch khám và hồ sơ liên quan đã được lưu trong PostgreSQL; quyền xem chi tiết phụ thuộc vai trò đăng nhập.</div></div>`,`<button class="btn btn-primary" data-modal-cancel>Đóng</button>`);
    bindModalCancel();
  }
  function viewAppointment(dbId){
    const a=apiAppointments.find(x=>x.dbId===Number(dbId));
    if(!a){
      toast('Không tìm thấy lịch khám','','error');
      return;
    }
    const p=apiPatients.find(x=>x.id===a.patientId);
    const d=apiDoctors.find(x=>x.id===a.doctorId);
    openModal(
      'Chi tiết lịch khám',
      `${a.id} • ${statusLabel(a.status)}`,
      `<div class="grid grid-2"><div><div class="kicker">Bệnh nhân</div><h3>${esc(patientName(a.patientId))}</h3><p class="muted">${esc(p?.phone||'')}</p></div><div><div class="kicker">Bác sĩ</div><h3>${esc(doctorName(a.doctorId))}</h3><p class="muted">${esc(d?.specialty||'')}</p></div></div><div class="divider"><span>Lịch hẹn</span></div><div class="grid grid-3"><div><div class="kicker">Ngày</div><strong>${fmtDate(a.date)}</strong></div><div><div class="kicker">Thời gian</div><strong>${a.start} – ${a.end}</strong></div><div><div class="kicker">Trạng thái</div>${statusBadge(a.status)}</div></div><div class="divider"><span>Lý do khám</span></div><p style="font-size:12px">${esc(a.reason||'—')}</p><div class="notice-card" style="margin-top:12px"><p><strong>ID PostgreSQL:</strong> ${a.dbId}</p></div>`,
      `<button class="btn btn-primary" data-modal-cancel>Đóng</button>`
    );
    bindModalCancel();
  }

  function cancelAppointment(dbId){
    const a=apiAppointments.find(x=>x.dbId===Number(dbId));
    if(!a){
      toast('Không tìm thấy lịch khám','','error');
      return;
    }

    openModal(
      'Xác nhận hủy lịch',
      `${a.id} • ${patientName(a.patientId)}`,
      `<div class="danger-banner info-banner"><div><strong>Bạn có chắc muốn hủy lịch này?</strong><br>Lịch không bị xóa khỏi database; trạng thái sẽ chuyển sang “Đã hủy” để phục vụ tra cứu.</div></div>`,
      `<button class="btn btn-outline" data-modal-cancel>Không hủy</button><button class="btn btn-danger" data-confirm-cancel>Hủy lịch</button>`
    );
    bindModalCancel();

    byId('modalFooter').querySelector('[data-confirm-cancel]').onclick=async()=>{
      const btn=byId('modalFooter').querySelector('[data-confirm-cancel]');
      btn.disabled=true;
      try{
        await apiRequest(`/appointments/${a.dbId}`,{
          method:'PUT',
          body:JSON.stringify({status:'cancelled'})
        });
        closeModal();
        toast('Đã hủy lịch khám','Trạng thái đã được cập nhật trong PostgreSQL');
        await refreshAppointmentsPage();
      }catch(err){
        toast('Không thể hủy lịch',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  function openExam(appointmentDbId){
    const a=apiAppointments.find(x=>x.dbId===Number(appointmentDbId));
    const r=apiMedicalRecords.find(x=>x.appointmentDbId===Number(appointmentDbId));
    if(!a){ toast('Không tìm thấy lịch khám','','error'); return; }

    openModal(r?'Cập nhật phiếu khám':'Lập phiếu khám',`${a.id} • ${patientName(a.patientId)}`,examinationForm(a,r||{}),`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-exam>Lưu phiếu khám</button>`,true);
    bindModalCancel();

    byId('modalFooter').querySelector('[data-save-exam]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const x=formData(f);
      const payload={
        symptoms:x.symptoms,
        conclusion:x.conclusion,
        doctor_note:x.doctorNote||null,
        post_visit_guidance:x.postVisitGuidance||null
      };
      if(!r) payload.appointment_id=a.dbId;

      const btn=byId('modalFooter').querySelector('[data-save-exam]');
      btn.disabled=true;
      try{
        await apiRequest(r?`/medical-records/${r.dbId}`:'/medical-records',{
          method:r?'PUT':'POST',
          body:JSON.stringify(payload)
        });
        closeModal();
        toast('Đã lưu phiếu khám','Lịch khám được chuyển sang Đã khám khi tạo phiếu mới');
        await refreshDoctorWorkspace('examination');
      }catch(err){
        toast('Không thể lưu phiếu khám',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  function openPrescription(appointmentDbId){
    const a=apiAppointments.find(x=>x.dbId===Number(appointmentDbId));
    const r=apiMedicalRecords.find(x=>x.appointmentDbId===Number(appointmentDbId));
    if(!a||!r){ toast('Chưa có phiếu khám','Hãy lập phiếu khám trước.','error'); return; }

    openModal('Lập đơn thuốc',`${a.id} • ${patientName(a.patientId)}`,`<form id="entityForm" class="form-grid"><div class="field full"><div class="info-banner"><div><strong>Kết luận khám:</strong> ${esc(r.conclusion||'')}</div></div></div><label class="field full required"><span>Nội dung đơn thuốc</span><textarea name="prescriptionNote" required placeholder="Ví dụ: Paracetamol 500mg - 1 viên khi đau...">${esc(r.prescriptionNote||'')}</textarea><small>Theo thiết kế 10 bảng: đơn thuốc được lưu tại medical_records.prescription_note.</small></label></form>`,`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-rx>Lưu đơn thuốc</button>`);
    bindModalCancel();

    byId('modalFooter').querySelector('[data-save-rx]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const prescriptionNote=formData(f).prescriptionNote;
      try{
        await apiRequest(`/medical-records/${r.dbId}`,{
          method:'PUT',
          body:JSON.stringify({prescription_note:prescriptionNote})
        });
        closeModal();
        toast('Đã lưu đơn thuốc','prescription_note đã cập nhật trong PostgreSQL');
        await refreshDoctorWorkspace('prescription');
      }catch(err){
        toast('Không thể lưu đơn thuốc',err.message,'error');
      }
    };
  }

  async function invoiceEditor(invoiceDbId=null){
    try{
      await loadInvoiceOptions();
      if(!apiInvoices.length) await loadApiInvoices();
    }catch(err){
      toast('Không tải được dữ liệu hóa đơn',err.message,'error');
      return;
    }

    const invoice=invoiceDbId?apiInvoices.find(x=>x.dbId===Number(invoiceDbId)):null;
    const candidates=(invoiceOptions.appointments||[]).filter(a=>!a.existing_invoice_id||a.existing_invoice_id===invoice?.dbId);
    const activeServices=apiServices.filter(s=>s.status==='active'||invoice?.items.some(it=>it.serviceDbId===s.dbId));

    if(!candidates.length && !invoice){
      toast('Không có lịch khám để lập hóa đơn','Mỗi lịch chỉ có tối đa một hóa đơn.','error');
      return;
    }
    if(!activeServices.length){
      toast('Chưa có dịch vụ','Hãy tạo ít nhất một dịch vụ hoạt động trước.','error');
      return;
    }

    const items=(invoice?.items?.length?invoice.items:[{serviceDbId:activeServices[0].dbId,quantity:1,unitPrice:activeServices[0].unitPrice}]);

    const html=`<form id="invoiceForm" class="form-grid"><label class="field full required"><span>Lịch khám</span><select name="appointmentId" required>${candidates.map(a=>`<option value="${a.id}" ${invoice?.appointmentDbId===a.id?'selected':''}>LK${String(a.id).padStart(3,'0')} • ${esc(a.patient_name)} • ${fmtDate(a.appointment_date)} ${String(a.start_time||'').slice(0,5)}</option>`).join('')}</select></label><div class="field full"><span>Dịch vụ</span><div id="invoiceItems" class="invoice-items">${items.map((it,i)=>invoiceItemRow(it,i)).join('')}</div><button type="button" class="btn btn-ghost btn-sm" id="addInvoiceItem" style="margin-top:8px">${icon('plus')}Thêm dịch vụ</button></div><label class="field"><span>Giảm giá</span><input type="number" min="0" step="1000" name="discount" value="${invoice?.discount||0}"></label><label class="field"><span>Trạng thái</span><select name="paymentStatus"><option value="unpaid" ${invoice?.paymentStatus==='unpaid'||!invoice?'selected':''}>Chưa thanh toán</option><option value="paid" ${invoice?.paymentStatus==='paid'?'selected':''}>Đã thanh toán</option><option value="cancelled" ${invoice?.paymentStatus==='cancelled'?'selected':''}>Đã hủy</option></select></label><label class="field full"><span>Phương thức thanh toán</span><select name="paymentMethod"><option value="">-- Chưa ghi nhận --</option><option value="Tiền mặt" ${invoice?.paymentMethod==='Tiền mặt'?'selected':''}>Tiền mặt</option><option value="Chuyển khoản" ${invoice?.paymentMethod==='Chuyển khoản'?'selected':''}>Chuyển khoản</option></select></label><div class="field full"><div id="invoiceTotals" class="invoice-total"></div></div></form>`;

    openModal(invoice?'Cập nhật hóa đơn':'Lập hóa đơn',invoice?.id||'Giao dịch mới',html,`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-invoice>Lưu hóa đơn</button>`,true);
    bindModalCancel();

    const refresh=()=>{byId('invoiceTotals').innerHTML=invoiceTotalsHTML();};

    byId('addInvoiceItem').onclick=()=>{
      const idx=byId('invoiceItems').children.length;
      const first=activeServices[0];
      byId('invoiceItems').insertAdjacentHTML('beforeend',invoiceItemRow({serviceDbId:first.dbId,quantity:1,unitPrice:first.unitPrice},idx));
      bindInvoiceRows();
      refresh();
    };

    function bindInvoiceRows(){
      byId('invoiceItems').querySelectorAll('select[data-service]').forEach(s=>s.onchange=()=>{
        const row=s.closest('.invoice-item');
        const svc=apiServices.find(x=>x.dbId===Number(s.value));
        row.querySelector('[data-price]').value=svc?.unitPrice||0;
        refresh();
      });
      byId('invoiceItems').querySelectorAll('input[data-qty]').forEach(x=>x.oninput=refresh);
      byId('invoiceItems').querySelectorAll('[data-remove-item]').forEach(b=>b.onclick=()=>{
        if(byId('invoiceItems').children.length>1){b.closest('.invoice-item').remove();refresh();}
      });
      byId('invoiceForm').discount.oninput=refresh;
    }

    bindInvoiceRows();
    refresh();

    byId('modalFooter').querySelector('[data-save-invoice]').onclick=async()=>{
      const f=byId('invoiceForm');
      if(!f.reportValidity()) return;
      const d=formData(f);
      const rows=[...byId('invoiceItems').children];
      const lineItems=rows.map(row=>({
        service_id:Number(row.querySelector('select[data-service]').value),
        quantity:Number(row.querySelector('[data-qty]').value)
      }));

      if(d.paymentStatus==='paid'&&!d.paymentMethod){
        toast('Thiếu phương thức thanh toán','Vui lòng chọn Tiền mặt hoặc Chuyển khoản','error');
        return;
      }

      const payload={
        appointment_id:Number(d.appointmentId),
        discount_amount:Number(d.discount)||0,
        payment_status:d.paymentStatus,
        payment_method:d.paymentMethod||null,
        items:lineItems
      };

      const btn=byId('modalFooter').querySelector('[data-save-invoice]');
      btn.disabled=true;
      try{
        await apiRequest(invoice?`/invoices/${invoice.dbId}`:'/invoices',{
          method:invoice?'PUT':'POST',
          body:JSON.stringify(payload)
        });
        closeModal();
        toast('Đã lưu hóa đơn','Tổng tiền đã được FastAPI tính từ đơn giá dịch vụ');
        await refreshInvoicePage();
      }catch(err){
        toast('Không thể lưu hóa đơn',err.message,'error');
        btn.disabled=false;
      }
    };
  }

  function invoiceItemRow(it,i){
    const selectedId=Number(it.serviceDbId||it.service_id||0);
    return `<div class="invoice-item"><select data-service name="service_${i}">${apiServices.filter(s=>s.status==='active'||s.dbId===selectedId).map(s=>`<option value="${s.dbId}" ${selectedId===s.dbId?'selected':''}>${esc(s.name)}</option>`).join('')}</select><input data-qty type="number" min="1" value="${it.quantity||1}" title="Số lượng"><input data-price type="number" readonly value="${it.unitPrice||apiServices.find(s=>s.dbId===selectedId)?.unitPrice||0}" title="Đơn giá từ PostgreSQL"><button type="button" class="icon-btn" data-remove-item>${icon('trash')}</button></div>`;
  }

  function invoiceTotalsHTML(){
    const rows=[...byId('invoiceItems').children];
    const gross=rows.reduce((s,row)=>s+Number(row.querySelector('[data-qty]').value||0)*Number(row.querySelector('[data-price]').value||0),0);
    const discount=Number(byId('invoiceForm').discount.value||0);
    const total=Math.max(0,gross-discount);
    return `<div><span>Tạm tính</span><strong>${money.format(gross)}</strong></div><div><span>Giảm giá</span><strong>− ${money.format(discount)}</strong></div><div class="grand"><span>Tổng thanh toán</span><strong>${money.format(total)}</strong></div>`;
  }

  function viewInvoice(dbId){
    const i=apiInvoices.find(x=>x.dbId===Number(dbId));
    if(!i){toast('Không tìm thấy hóa đơn','','error');return;}
    openModal('Chi tiết hóa đơn',`${i.id} • ${fmtDate(i.invoiceDate)}`,`<div class="grid grid-2"><div><div class="kicker">Bệnh nhân</div><h3>${esc(i.patientName||'—')}</h3><p class="muted">${i.appointmentId||'Không gắn lịch'}</p></div><div><div class="kicker">Thanh toán</div>${statusBadge(i.paymentStatus)}<p class="muted">${esc(i.paymentMethod||'Chưa ghi nhận')}</p></div></div><div class="divider"><span>Dịch vụ</span></div><div class="list">${i.items.map(it=>`<div class="list-item"><div class="grow"><strong>${esc(it.serviceName)}</strong><small>${it.quantity} × ${money.format(it.unitPrice)}</small></div><strong>${money.format(it.lineTotal)}</strong></div>`).join('')}</div><div class="invoice-total"><div><span>Giảm giá</span><strong>${money.format(i.discount)}</strong></div><div class="grand"><span>Tổng tiền</span><strong>${money.format(i.total)}</strong></div></div>`,`<button class="btn btn-outline" data-print-invoice>${icon('file')}In hóa đơn</button><button class="btn btn-primary" data-modal-cancel>Đóng</button>`);
    bindModalCancel();
    byId('modalFooter').querySelector('[data-print-invoice]').onclick=()=>window.print();
  }

  function bindTableFilter(inputId, rowTextFn, extraFn=()=>true){ const input=byId(inputId);if(!input)return;const run=()=>{const q=input.value.trim().toLowerCase();byId('content').querySelectorAll('tbody tr').forEach((tr,i)=>{tr.style.display=rowTextFn(tr,i).toLowerCase().includes(q)&&extraFn(tr,i)?'':'none';});};input.addEventListener('input',run);return run; }
  function exportCSV(filename,headers,rows){ const csv=[headers,...rows].map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n');const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();URL.revokeObjectURL(a.href); }

  // --- ROUTE BINDERS ---
  const routeBinders={
    dashboard(){bindCommon();refreshDashboard();},
    users(){bindCommon();bindUsersPage();refreshUsersPage();},
    doctors(){bindCommon();bindDoctorControls();refreshDoctorsPage();},
    shifts(){bindCommon();bindShiftControls();refreshShiftsPage();},
    reports(){bindCommon();bindReportPage();refreshReportPage();},
    logs(){bindCommon();bindLogsPage();refreshLogsPage();},
    patients(){bindCommon();bindPatientControls();refreshPatientsPage();},
    appointments(){bindCommon();bindAppointmentPage();refreshAppointmentsPage();},
    billing(){bindCommon();bindInvoicePage();refreshInvoicePage();},
    search(){
      bindCommon();
      const q=byId('receptionSearch'),scope=byId('receptionScope'),out=byId('receptionResults');
      const run=async()=>{
        const keyword=q.value.trim();
        if(!keyword){out.innerHTML='<div class="empty"><strong>Nhập từ khóa để tra cứu</strong>Có thể tìm theo tên, SĐT, mã bệnh nhân, lịch hoặc bác sĩ.</div>';return;}
        out.innerHTML='<div class="empty"><strong>Đang tra cứu...</strong></div>';
        try{
          let patients=[],appointments=[];
          if(scope.value!=='appointment'){
            const pData=await apiRequest(`/patients?${new URLSearchParams({q:keyword,limit:'200'}).toString()}`);
            patients=(pData?.items||[]).map(patientFromApi);
          }
          if(scope.value!=='patient'){
            // Load full references so appointment search results always show the correct names.
            const [pRef,dRef]=await Promise.all([
              apiRequest('/patients?limit=200'),
              apiRequest('/doctors?limit=200')
            ]);
            apiPatients=(pRef?.items||[]).map(patientFromApi);
            apiDoctors=(dRef?.items||[]).map(doctorFromApi);
            const aData=await apiRequest(`/appointments?${new URLSearchParams({q:keyword,limit:'200'}).toString()}`);
            appointments=(aData?.items||[]).map(appointmentFromApi);
          }
          if(patients.length){const merged=new Map(apiPatients.map(x=>[x.dbId,x]));patients.forEach(x=>merged.set(x.dbId,x));apiPatients=[...merged.values()];}
          if(appointments.length){const merged=new Map(apiAppointments.map(x=>[x.dbId,x]));appointments.forEach(x=>merged.set(x.dbId,x));apiAppointments=[...merged.values()];}
          out.innerHTML=`${scope.value!=='appointment'?`<div class="kicker">Bệnh nhân (${patients.length})</div><div class="list">${patients.map(x=>`<div class="list-item"><div class="grow"><strong>${esc(x.fullName)}</strong><small>${x.id} • ${esc(x.phone)} • ${esc(x.address||'—')}</small></div><button class="btn btn-sm btn-outline" data-view-patient="${x.dbId}">Xem</button></div>`).join('')||'<div class="empty">Không có kết quả bệnh nhân</div>'}</div>`:''}${scope.value!=='patient'?`<div class="kicker" style="margin-top:20px">Lịch khám (${appointments.length})</div><div class="list">${appointments.map(x=>`<div class="list-item"><div class="grow"><strong>${x.id} • ${esc(patientName(x.patientId))}</strong><small>${fmtDate(x.date)} ${x.start}–${x.end} • ${esc(doctorName(x.doctorId))}</small></div><button class="btn btn-sm btn-outline" data-view-appt="${x.dbId}">Xem</button></div>`).join('')||'<div class="empty">Không có kết quả lịch khám</div>'}</div>`:''}`;
          out.querySelectorAll('[data-view-patient]').forEach(b=>b.onclick=()=>viewPatient(b.dataset.viewPatient));
          out.querySelectorAll('[data-view-appt]').forEach(b=>b.onclick=()=>viewAppointment(b.dataset.viewAppt));
        }catch(err){out.innerHTML=`<div class="empty"><strong>Không thể tra cứu</strong>${esc(err.message)}</div>`;}
      };
      const debounced=debounce(run,350);q.oninput=debounced;scope.onchange=run;
      run();
    },
    'doctor-schedule'(){bindCommon();refreshDoctorWorkspace('doctor-schedule');},
    records(){bindCommon();refreshDoctorWorkspace('records');},
    examination(){bindCommon();refreshDoctorWorkspace('examination');},
    prescription(){bindCommon();refreshDoctorWorkspace('prescription');},
    'ai-summary'(){bindCommon();refreshDoctorWorkspace('ai-summary');},
    services(){bindCommon();bindServicePage();refreshServicesPage();},
    invoices(){bindCommon();bindInvoicePage();refreshInvoicePage();},
    'finance-report'(){bindCommon();refreshFinanceReport();},
    'finance-search'(){bindCommon();refreshFinanceSearch();},
    profile(){bindCommon();refreshPatientPortalPage('profile');},
    booking(){bindCommon();refreshPatientPortalPage('booking');},
    'my-appointments'(){bindCommon();refreshPatientPortalPage('my-appointments');},
    chatbot(){bindCommon();const form=byId('chatForm'),input=byId('chatInput'),msgs=byId('chatMessages');const send=async q=>{q=q.trim();if(!q)return;msgs.insertAdjacentHTML('beforeend',`<div class="chat-msg user">${esc(q)}</div>`);input.value='';msgs.insertAdjacentHTML('beforeend',`<div class="chat-msg bot" id="aiTyping">AI đang xử lý...</div>`);msgs.scrollTop=msgs.scrollHeight;try{const data=await apiRequest('/ai/chat',{method:'POST',body:JSON.stringify({question:q})});byId('aiTyping')?.remove();msgs.insertAdjacentHTML('beforeend',`<div class="chat-msg bot">${aiMarkdown(data.content)}<br><small>${esc(data.warning||'')}</small></div>`);}catch(err){byId('aiTyping')?.remove();msgs.insertAdjacentHTML('beforeend',`<div class="chat-msg bot">Không thể gọi AI: ${esc(err.message)}</div>`);}msgs.scrollTop=msgs.scrollHeight;};form.onsubmit=e=>{e.preventDefault();send(input.value)};byId('content').querySelectorAll('[data-q]').forEach(b=>b.onclick=()=>send(b.dataset.q));},
    guidance(){bindCommon();refreshPatientPortalPage('guidance');}
  };

  async function refreshAppointmentsPage(){
    try{
      await Promise.all([loadApiPatients(),loadApiDoctors()]);
      await Promise.all([loadApiShifts(),loadApiAppointments()]);
      if(currentRoute!=='appointments') return;
      byId('content').innerHTML=renderAppointments();
      bindCommon();
      bindAppointmentPage();
    }catch(err){
      if(currentRoute==='appointments') toast('Không kết nối được Appointments API',err.message,'error');
    }
  }

  function bindAppointmentPage(){
    const root=byId('content');
    root.querySelector('[data-add-appt]')?.addEventListener('click',()=>openAppointmentModal());
    root.querySelectorAll('[data-view-appt]').forEach(b=>b.onclick=()=>viewAppointment(b.dataset.viewAppt));
    root.querySelectorAll('[data-edit-appt]').forEach(b=>b.onclick=()=>openAppointmentModal(b.dataset.editAppt));
    root.querySelectorAll('[data-cancel-appt]').forEach(b=>b.onclick=()=>cancelAppointment(b.dataset.cancelAppt));
    root.querySelector('[data-refresh-appointments]')?.addEventListener('click',()=>refreshAppointmentsPage());

    const q=byId('apptFilter');
    const dateInput=byId('apptDateFilter');
    const statusInput=byId('apptStatusFilter');

    if(q){
      q.addEventListener('input',debounce(()=>{
        appointmentQuery=q.value;
        refreshAppointmentsPage();
      },350));
    }
    if(dateInput){
      dateInput.onchange=()=>{
        appointmentDateQuery=dateInput.value;
        refreshAppointmentsPage();
      };
    }
    if(statusInput){
      statusInput.onchange=()=>{
        appointmentStatusQuery=statusInput.value;
        refreshAppointmentsPage();
      };
    }
  }
  async function refreshDoctorWorkspace(route=currentRoute){
    try{
      await loadDoctorContext();
      if(currentRoute!==route) return;
      byId('content').innerHTML=(routes[route]||renderDashboard)();
      bindCommon();

      if(route==='doctor-schedule'){
        byId('content').querySelectorAll('[data-view-appt]').forEach(b=>b.onclick=()=>viewAppointment(b.dataset.viewAppt));
        const dateInput=byId('doctorScheduleDate');
        if(dateInput) dateInput.onchange=()=>{ doctorScheduleDate=dateInput.value; refreshDoctorWorkspace('doctor-schedule'); };
        byId('content').querySelector('[data-clear-doctor-date]')?.addEventListener('click',()=>{ doctorScheduleDate=''; refreshDoctorWorkspace('doctor-schedule'); });
      }
      if(route==='records'){
        const recordFilter=byId('doctorRecordFilter');
        if(recordFilter) recordFilter.addEventListener('input',debounce(()=>{ doctorRecordQuery=recordFilter.value; refreshDoctorWorkspace('records'); },300));
        byId('content').querySelectorAll('[data-record-patient]').forEach(b=>b.onclick=()=>{
          const p=apiPatients.find(x=>x.dbId===Number(b.dataset.recordPatient));
          const aps=myDoctorAppointments().filter(a=>a.patientId===p?.id);
          const rs=apiMedicalRecords.filter(r=>aps.some(a=>a.dbId===r.appointmentDbId));
          openModal('Hồ sơ bệnh nhân',`${p.id} • phạm vi được phép`,`<div class="profile-card"><div class="profile-avatar">${initials(p.fullName)}</div><div><h3>${esc(p.fullName)}</h3><p>${esc(p.phone)} • ${fmtDate(p.dob)}</p></div></div><div class="divider"><span>Lịch sử khám</span></div>${rs.map(r=>`<div class="notice-card card" style="margin-bottom:10px"><h4>${fmtDate(r.appointmentDate)} • ${esc(r.doctorName)}</h4><p><strong>Triệu chứng:</strong> ${esc(r.symptoms||'—')}<br><strong>Kết luận:</strong> ${esc(r.conclusion||'—')}<br><strong>Đơn thuốc:</strong> ${esc(r.prescriptionNote||'Không có')}</p></div>`).join('')||'<div class="empty">Chưa có phiếu khám.</div>'}`,`<button class="btn btn-primary" data-modal-cancel>Đóng</button>`,true);
          bindModalCancel();
        });
      }
      if(route==='examination'){
        byId('content').querySelectorAll('[data-exam]').forEach(b=>b.onclick=()=>openExam(b.dataset.exam));
        byId('content').querySelectorAll('[data-ai-guidance]').forEach(b=>b.onclick=async()=>{
          const recordId=b.dataset.aiGuidance; b.disabled=true;
          try{
            const data=await apiRequest(`/ai/guidance/${recordId}`,{method:'POST',body:JSON.stringify({save:false})});
            openModal('AI hướng dẫn sau khám','Bản nháp AI — Bác sĩ cần xem lại trước khi lưu',`<div class="ai-output ai-output-modal"><span class="ai-badge">AI • KT3 • ${esc(data.model)}</span><div class="ai-draft-content">${aiMarkdown(data.content)}</div><div class="ai-draft-warning">${esc(data.warning||'AI tạo bản nháp; bác sĩ cần kiểm tra trước khi lưu.')}</div></div>`,`<button class="btn btn-outline" data-modal-cancel>Không lưu</button><button class="btn btn-primary" data-approve-ai-guidance>Duyệt & lưu</button>`,true);
            bindModalCancel();
            byId('modalFooter').querySelector('[data-approve-ai-guidance]').onclick=async()=>{
              const saveBtn=byId('modalFooter').querySelector('[data-approve-ai-guidance]'); saveBtn.disabled=true;
              try{
                await apiRequest(`/ai/guidance/${recordId}/save`,{method:'POST',body:JSON.stringify({content:data.content})});
                closeModal(); toast('Đã lưu hướng dẫn','Bác sĩ đã duyệt và lưu bản hướng dẫn sau khám.','success'); await loadDoctorContext();
              }catch(err){toast('Không lưu được hướng dẫn',err.message,'error');saveBtn.disabled=false;}
            };
          }catch(err){toast('Không tạo được hướng dẫn AI',err.message,'error');}
          finally{b.disabled=false;}
        });
      }
      if(route==='prescription'){
        byId('content').querySelectorAll('[data-prescribe]').forEach(b=>b.onclick=()=>openPrescription(b.dataset.prescribe));
      }
      if(route==='ai-summary'){
        byId('generateSummary').onclick=async()=>{
          const pid=byId('aiPatient').value;
          if(!pid){toast('Chưa chọn bệnh nhân','Vui lòng chọn hồ sơ cần tóm tắt','error');return;}
          const patient=apiPatients.find(p=>p.id===pid);
          if(!patient){toast('Không tìm thấy bệnh nhân','Hãy tải lại dữ liệu','error');return;}
          const summaryBtn=byId('generateSummary');
          summaryBtn.disabled=true;
          byId('aiSummaryOutput').innerHTML='<span class="ai-badge">AI • KT3</span><br>Đang tạo tóm tắt đầy đủ...';
          try{
            const data=await apiRequest(`/ai/summary/${patient.dbId}`,{method:'POST'});
            byId('aiSummaryOutput').innerHTML=`<span class="ai-badge">AI • KT3 • ${esc(data.model)}</span><div style="margin-top:12px">${aiMarkdown(data.content)}</div><br><em>${esc(data.warning||'')}</em>`;
          }catch(err){
            byId('aiSummaryOutput').innerHTML=`<span class="ai-badge">AI • LỖI</span><br>${esc(err.message)}`;
          }finally{ summaryBtn.disabled=false; }
        };
      }
    }catch(err){
      if(currentRoute===route) toast('Không tải được dữ liệu bác sĩ',err.message,'error');
    }
  }

  async function refreshInvoicePage(){
    try{
      await Promise.all([loadApiServices(),loadApiInvoices()]);
      if(!['invoices','billing'].includes(currentRoute)) return;
      byId('content').innerHTML=currentRoute==='billing'?renderBilling():renderInvoices();
      bindCommon();
      bindInvoicePage();
    }catch(err){
      if(['invoices','billing'].includes(currentRoute)) toast('Không tải được Invoices API',err.message,'error');
    }
  }

  function bindInvoicePage(){
    const root=byId('content');
    root.querySelector('[data-new-invoice]')?.addEventListener('click',()=>invoiceEditor());
    root.querySelectorAll('[data-view-invoice]').forEach(b=>b.onclick=()=>viewInvoice(b.dataset.viewInvoice));
    root.querySelectorAll('[data-edit-invoice]').forEach(b=>b.onclick=()=>invoiceEditor(b.dataset.editInvoice));
    root.querySelector('[data-refresh-invoices]')?.addEventListener('click',()=>refreshInvoicePage());

    const q=byId('invoiceFilter'),sf=byId('invoiceStatusFilter');
    if(q) q.addEventListener('input',debounce(()=>{invoiceQuery=q.value;refreshInvoicePage();},350));
    if(sf) sf.onchange=()=>{invoiceStatusQuery=sf.value;refreshInvoicePage();};
  }

  async function refreshReportPage(){
    try{
      await loadReportSummary();
      if(currentRoute!=='reports') return;
      byId('content').innerHTML=renderReports();
      bindCommon();
      bindReportPage();
    }catch(err){if(currentRoute==='reports') toast('Không tải được báo cáo',err.message,'error');}
  }

  function bindReportPage(){
    const root=byId('content');
    root.querySelector('[data-refresh-report]')?.addEventListener('click',async()=>{
      try{
        await loadReportSummary(byId('reportFrom').value,byId('reportTo').value);
        byId('content').innerHTML=renderReports();bindCommon();bindReportPage();
      }catch(err){toast('Không tải được báo cáo',err.message,'error');}
    });
    root.querySelector('[data-export-report]')?.addEventListener('click',()=>exportCSV('bao-cao-tong-quan.csv',['Trạng thái','Số lượng'],Object.entries(reportSummary?.appointments_by_status||{})));
  }

  async function refreshLogsPage(){
    try{
      await loadApiLogs();
      if(currentRoute!=='logs') return;
      byId('content').innerHTML=renderLogs();
      bindCommon();
      bindLogsPage();
    }catch(err){if(currentRoute==='logs') toast('Không tải được System Logs',err.message,'error');}
  }

  function bindLogsPage(){
    const q=byId('logFilter');
    if(q) q.addEventListener('input',debounce(()=>{logQuery=q.value;refreshLogsPage();},350));
    byId('content').querySelector('[data-refresh-logs]')?.addEventListener('click',()=>refreshLogsPage());
  }

  async function refreshFinanceReport(){
    try{
      await loadReportSummary();
      if(currentRoute!=='finance-report') return;
      byId('content').innerHTML=renderFinanceReport();
      bindCommon();
      byId('content').querySelector('[data-export-invoice]')?.addEventListener('click',()=>exportCSV('bao-cao-hoa-don.csv',['Mã HD','Ngày','Bệnh nhân','Tổng tiền','Trạng thái'],apiInvoices.map(i=>[i.id,i.invoiceDate,i.patientName,i.total,statusLabel(i.paymentStatus)])));
    }catch(err){if(currentRoute==='finance-report') toast('Không tải được báo cáo tài chính',err.message,'error');}
  }

  async function refreshFinanceSearch(){
    try{
      await Promise.all([loadApiServices(),loadApiInvoices()]);
      if(currentRoute!=='finance-search') return;
      const q=byId('financeSearch'),scope=byId('financeScope'),out=byId('financeResults');
      const run=()=>{
        const s=q.value.trim().toLowerCase();
        if(!s){out.innerHTML='<div class="empty"><strong>Nhập từ khóa để tra cứu</strong>Tìm mã hóa đơn, bệnh nhân hoặc dịch vụ.</div>';return;}
        const inv=apiInvoices.filter(i=>[i.id,i.appointmentId,i.patientId,i.patientName,i.patientPhone,i.paymentMethod,statusLabel(i.paymentStatus)].join(' ').toLowerCase().includes(s));
        const sv=apiServices.filter(x=>[x.id,x.name].join(' ').toLowerCase().includes(s));
        out.innerHTML=`${scope.value!=='service'?`<div class="kicker">Hóa đơn (${inv.length})</div><div class="list">${inv.map(i=>`<div class="list-item"><div class="grow"><strong>${i.id} • ${money.format(i.total)}</strong><small>${esc(i.patientName||'')} • ${statusLabel(i.paymentStatus)}</small></div><button class="btn btn-sm btn-outline" data-view-invoice="${i.dbId}">Xem</button></div>`).join('')||'<div class="empty">Không có kết quả</div>'}</div>`:''}${scope.value!=='invoice'?`<div class="kicker" style="margin-top:20px">Dịch vụ (${sv.length})</div><div class="list">${sv.map(x=>`<div class="list-item"><div class="grow"><strong>${esc(x.name)}</strong><small>${x.id} • ${money.format(x.unitPrice)}</small></div>${statusBadge(x.status)}</div>`).join('')||'<div class="empty">Không có kết quả</div>'}</div>`:''}`;
        out.querySelectorAll('[data-view-invoice]').forEach(b=>b.onclick=()=>viewInvoice(b.dataset.viewInvoice));
      };
      q.oninput=run;scope.onchange=run;
      run();
    }catch(err){if(currentRoute==='finance-search') toast('Không tải được tra cứu tài chính',err.message,'error');}
  }

  async function refreshGuidancePage(){
    try{
      await loadPatientGuidance();
      if(currentRoute!=='guidance') return;
      byId('content').innerHTML=renderGuidance();
      bindCommon();
    }catch(err){if(currentRoute==='guidance') toast('Không tải được hướng dẫn sau khám',err.message,'error');}
  }

  async function refreshPatientPortalPage(route=currentRoute){
    try{
      await loadPatientPortal();
      if(currentRoute!==route) return;
      byId('content').innerHTML=(routes[route]||renderDashboard)();
      bindCommon();
      bindPatientPortalRoute(route);
    }catch(err){
      if(currentRoute===route) toast('Không tải được Patient Portal',err.message,'error');
    }
  }

  function bindPatientPortalRoute(route){
    if(route==='profile'){
      const form=byId('profileForm');
      if(form) form.onsubmit=async e=>{
        e.preventDefault();
        const x=formData(form);
        try{
          await apiRequest('/patient-portal/profile',{
            method:'PUT',
            body:JSON.stringify({
              full_name:x.fullName,
              date_of_birth:x.dob||null,
              gender:x.gender||null,
              phone:x.phone,
              address:x.address||null,
              email:x.email||null
            })
          });
          currentUser().email=x.email||'';
          saveSession();
          toast('Đã cập nhật thông tin cá nhân');
          await refreshPatientPortalPage('profile');
        }catch(err){toast('Không thể cập nhật',err.message,'error');}
      };
    }

    if(route==='booking'){
      const form=byId('bookingForm');
      if(form) form.onsubmit=async e=>{
        e.preventDefault();
        const x=formData(form);
        try{
          await apiRequest('/patient-portal/appointments',{
            method:'POST',
            body:JSON.stringify({
              doctor_id:Number(x.doctorId),
              appointment_date:x.date,
              start_time:x.start,
              reason:x.reason
            })
          });
          toast('Đặt lịch thành công','Lịch đang ở trạng thái Chờ xác nhận');
          currentRoute='my-appointments';
          navigate('my-appointments');
        }catch(err){toast('Không thể đặt lịch',err.message,'error');}
      };
    }

    if(route==='my-appointments'){
      byId('content').querySelectorAll('[data-view-appt]').forEach(b=>b.onclick=()=>viewAppointment(b.dataset.viewAppt));
      byId('content').querySelectorAll('[data-patient-cancel]').forEach(b=>b.onclick=async()=>{
        const a=apiAppointments.find(x=>x.dbId===Number(b.dataset.patientCancel));
        if(!a||!window.confirm(`Hủy ${a.id}?`)) return;
        try{
          await apiRequest(`/patient-portal/appointments/${a.dbId}`,{
            method:'PUT',
            body:JSON.stringify({status:'cancelled'})
          });
          toast('Đã hủy lịch');
          await refreshPatientPortalPage('my-appointments');
        }catch(err){toast('Không thể hủy lịch',err.message,'error');}
      });
      byId('content').querySelectorAll('[data-patient-reschedule]').forEach(b=>b.onclick=()=>openPatientReschedule(b.dataset.patientReschedule));
    }
  }

  function openPatientReschedule(dbId){
    const a=apiAppointments.find(x=>x.dbId===Number(dbId));
    if(!a) return;
    const body=`<form id="entityForm" class="form-grid"><label class="field full required"><span>Bác sĩ</span><select name="doctorId" required>${apiDoctors.filter(d=>d.status==='active').map(d=>`<option value="${d.dbId}" ${d.dbId===a.doctorDbId?'selected':''}>${esc(d.fullName)} • ${esc(d.specialty)}</option>`).join('')}</select></label><label class="field required"><span>Ngày</span><input name="date" type="date" required value="${a.date}"></label><label class="field required"><span>Giờ bắt đầu</span><input name="start" type="time" required value="${a.start}"></label><label class="field full required"><span>Lý do</span><textarea name="reason" required>${esc(a.reason||'')}</textarea></label></form>`;
    openModal('Đổi lịch khám',a.id,body,`<button class="btn btn-outline" data-modal-cancel>Hủy</button><button class="btn btn-primary" data-save-reschedule>Lưu lịch mới</button>`);
    bindModalCancel();
    byId('modalFooter').querySelector('[data-save-reschedule]').onclick=async()=>{
      const f=byId('entityForm');
      if(!f.reportValidity()) return;
      const x=formData(f);
      try{
        await apiRequest(`/patient-portal/appointments/${a.dbId}`,{
          method:'PUT',
          body:JSON.stringify({
            doctor_id:Number(x.doctorId),
            appointment_date:x.date,
            start_time:x.start,
            reason:x.reason
          })
        });
        closeModal();
        toast('Đã đổi lịch','Lịch trở lại trạng thái Chờ xác nhận');
        await refreshPatientPortalPage('my-appointments');
      }catch(err){toast('Không thể đổi lịch',err.message,'error');}
    };
  }

  async function refreshDashboard(){
    const role=currentUser().role;
    try{
      if(role==='admin'){
        await Promise.all([loadApiUsers(),loadApiDoctors(),loadApiShifts(),loadReportSummary()]);
      }else if(role==='receptionist'){
        await Promise.all([loadApiPatients(),loadApiDoctors(),loadApiShifts(),loadApiAppointments(),loadApiServices(),loadApiInvoices()]);
      }else if(role==='doctor'){
        await loadDoctorContext();
      }else if(role==='accountant'){
        await Promise.all([loadApiServices(),loadApiInvoices(),loadReportSummary()]);
      }else if(role==='patient'){
        await loadPatientPortal();
      }
      if(currentRoute!=='dashboard') return;
      byId('content').innerHTML=renderDashboard();
      bindCommon();
      byId('content').querySelector('[data-new-invoice]')?.addEventListener('click',()=>invoiceEditor());
    }catch(err){if(currentRoute==='dashboard') toast('Một số dữ liệu tổng quan chưa tải được',err.message,'error');}
  }


  init();
})();
