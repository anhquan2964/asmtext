const express = require('express');
const multer = require('multer');
const mysql = require('mysql2/promise'); // Sử dụng phiên bản promise
const fs = require('fs');
const Papa = require('papaparse');
const path = require('path');

const app = express();
// Thiết lập EJS làm view engine
app.set('view engine', 'ejs');

const upload = multer({ dest: 'uploads/' });
let pool;

// Hàm khởi tạo cơ sở dữ liệu
const initializeDatabase = async () => {
    try {
        // Kết nối đến MySQL mà không chỉ định cơ sở dữ liệu
        const connection = await mysql.createConnection({
            host: 'localhost',
            user: 'root',
            password: ''
        });

        // Tạo cơ sở dữ liệu nếu chưa tồn tại
        await connection.query('CREATE DATABASE IF NOT EXISTS data');
        console.log('Cơ sở dữ liệu "data" đã được tạo hoặc đã tồn tại.');

        // Kết nối lại với cơ sở dữ liệu "data"
        pool = mysql.createPool({
            host: 'localhost',
            user: 'root',
            password: '',
            database: 'data' // Kết nối đến cơ sở dữ liệu "data"
        });

        // Tạo bảng nếu chưa tồn tại
        const createTableQuery = `
            CREATE TABLE IF NOT EXISTS datas (
                id INT AUTO_INCREMENT PRIMARY KEY,
                date_time VARCHAR(255),
                time TIME,
                trans_no VARCHAR(255),
                credit DECIMAL(10, 2),
                debit DECIMAL(10, 2),
                detail TEXT
            )
        `;
        await pool.query(createTableQuery);
        console.log('Bảng "datas" đã được tạo');

    } catch (err) {
        console.error('Lỗi khi kết nối hoặc tạo cơ sở dữ liệu:', err);
        process.exit(1); // Dừng ứng dụng nếu có lỗi
    }
};

// Gọi hàm khởi tạo cơ sở dữ liệu
initializeDatabase();
// Hàm phân tích và chuyển đổi thời gian
function parseAndConvertTime(str) {
    const parts = str.split("_");
    const datePart = parts[0];  // "01/09/2024"
    const numberPart = parts[1]; // "6215.97152"

    const seconds = parseFloat(numberPart); // Chuyển đổi chuỗi số thành số thực
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60); // Làm tròn giây

    // Tạo đối tượng thời gian theo định dạng HH:mm:ss
    const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;

    return {
        date: datePart,
        time: time
    };
}

// Hàm chèn dữ liệu vào MySQL
const insertData = async (data) => {
    // Kết nối đến cơ sở dữ liệu 'data'
    const dbConnection = await mysql.createConnection({
        host: 'localhost',
        user: 'root',
        password: '',
        database: 'data'
    });

    const query = `INSERT INTO datas (date_time, time, trans_no, credit, debit, detail) VALUES ?`;
    const values = data.map(row => {
        const { date, time } = parseAndConvertTime(row.date_time);
        return [date, time, row.trans_no, row.credit, row.debit, row.detail];
    });

    const batchSize = 1000; // Kích thước batch
    for (let i = 0; i < values.length; i += batchSize) {
        const batch = values.slice(i, i + batchSize);
        await dbConnection.query(query, [batch]);
    }

    console.log('Chèn dữ liệu thành công!');

    // Đóng kết nối
    await dbConnection.end();
};


// Tải lên tệp CSV
app.post('/uploads', upload.single('file'), async (req, res) => {
    const startTime = new Date(); // Bắt đầu đo thời gian

    if (!req.file) {
        return res.status(400).send('Vui lòng tải lên một tệp CSV.');
    }

    const filePath = path.join(__dirname, req.file.path);
    const fileContent = fs.readFileSync(filePath, 'utf8');

    // Sử dụng PapaParse để phân tích CSV
    Papa.parse(fileContent, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {            
            if (results.data.length > 0) {
                try {
                    await insertData(results.data); // Chèn dữ liệu vào MySQL

                    const endTime = new Date(); // Kết thúc đo thời gian
                    const processingTime = endTime - startTime; // Tính toán thời gian xử lý
                    res.redirect('/'); // Thông báo cho người dùng
                    
                } catch (error) {
                    console.error('Có lỗi xảy ra trong quá trình chèn dữ liệu:', error);
                    res.status(500).send('Có lỗi xảy ra trong quá trình chèn dữ liệu.');
                }
            } else {
                res.send('Không có dữ liệu nào để chèn.');
            }

            fs.unlinkSync(filePath); // Xóa tệp sau khi xử lý
        },
        error: (error) => {
            console.error('Lỗi khi phân tích:', error);
            res.status(500).send('Có lỗi xảy ra trong quá trình phân tích tệp CSV.');
        }
    });
});

app.get('/filter', async (req, res) => {
    const startTime = new Date(); // Bắt đầu đo thời gian
    const { start_date, end_date, function: selectedFunction = 'transactionTable', page } = req.query;

    // Kiểm tra start_date và end_date
    if (!start_date || !end_date) {
        return res.render('products/index', { 
            dataResults: [], 
            start_date: '', 
            end_date: '',
            currentPage: 1,
            totalPages: 0,
            processingTime: null
        });
    }


    const startDateFormatted = start_date.split("-").reverse().join("-");
    const endDateFormatted = end_date.split("-").reverse().join("-");

    const limit = 100;
    const currentPage = page ? parseInt(page) : 1; 
    const offset = (currentPage - 1) * limit;

    try {
        let dataResults = [];

        if (selectedFunction === 'transactionTable') {
            console.log('Chức năng được chọn: transactionTable');

            // Truy vấn dữ liệu với LIMIT và OFFSET
            const queryData = `
                SELECT id, date_time, trans_no, credit, debit, detail 
                FROM datas 
                WHERE date_time >= ? AND date_time <= ?
                LIMIT ? OFFSET ?`;

            const [resultData] = await pool.query(queryData, [startDateFormatted, endDateFormatted, limit, offset]);
            dataResults = resultData || [];

            // Kiểm tra nếu không có dữ liệu trả về
            if (dataResults.length === 0) {
                console.log("Không có dữ liệu phù hợp.");
            }

            // Truy vấn để lấy tổng số bản ghi
            const [totalRowsResult] = await pool.query('SELECT COUNT(*) AS total FROM datas WHERE date_time >= ? AND date_time <= ?', [startDateFormatted, endDateFormatted]);
            const totalRows = totalRowsResult[0].total;

            // Tính toán tổng số trang
            const totalPages = Math.ceil(totalRows / limit);

            const endTime = new Date(); // Kết thúc đo thời gian
            const processingTime = endTime - startTime; // Tính toán thời gian xử lý

            return res.render('products/index', { 
                dataResults,
                start_date,
                end_date,
                currentPage,
                totalPages,
                processingTime: `${processingTime} ms`
            });
        } else {
            console.log('Giá trị function không hợp lệ:', selectedFunction);
            return res.status(400).send('Chức năng không hợp lệ.');
        }

    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu:', error);
        return res.status(500).send('Có lỗi xảy ra trong quá trình lấy dữ liệu.');
    }
});

app.get('/filter/totalAmountByDay', async (req, res) => {
    const startTime = new Date(); // Bắt đầu đo thời gian

    const { start_date, end_date } = req.query;
    if (!start_date || !end_date) {
        return res.status(400).send('Cần cung cấp start_date và end_date.');
    }

    const startDateFormatted = start_date.split("-").reverse().join("-");
    const endDateFormatted = end_date.split("-").reverse().join("-");

    const query = `
        SELECT date_time, SUM(COALESCE(credit, 0)) AS totalCredit
        FROM datas
        WHERE date_time >= ? AND date_time <= ?
        GROUP BY date_time
    `;

    try {
        const [results] = await pool.query(query, [startDateFormatted, endDateFormatted]);

        const endTime = new Date(); // Kết thúc đo thời gian
        const processingTime = endTime - startTime; // Tính toán thời gian xử lý

        res.render('products/index', { 
            results, 
            processingTime: `${processingTime} ms` // Hiển thị thời gian xử lý
        });
    } catch (error) {
        console.error('Lỗi khi thống kê tổng số tiền:', error);
        res.status(500).send('Có lỗi xảy ra trong quá trình thống kê.');
    }
});

app.get('/filter/transactionCountByAmount', async (req, res) => {
    const startTime = new Date(); // Bắt đầu đo thời gian

    const { min_amount, max_amount, page = 1 } = req.query; // Thêm tham số page
    const limit = 10; // Số lượng kết quả trên mỗi trang
    const currentPage = parseInt(page); // Trang hiện tại
    const offset = (currentPage - 1) * limit; // Tính toán offset

    if (!min_amount || !max_amount) {
        return res.render('products/index', { 
            transactionCount: 0,
            totalTransactions: 0,
            currentPage: 1,
            totalPages: 0,
            min_amount,
            max_amount
        });
    }

    const queryCount = `
        SELECT COUNT(*) AS count 
        FROM datas 
        WHERE credit BETWEEN ? AND ?`;

    const queryTransactions = `
        SELECT * 
        FROM datas 
        WHERE credit BETWEEN ? AND ?
        LIMIT ? OFFSET ?`;

    try {
        const [countResults] = await pool.query(queryCount, [min_amount, max_amount]);
        const transactionCount = countResults[0].count || 0;

        const [transactionResults] = await pool.query(queryTransactions, [min_amount, max_amount, limit, offset]);

        const endTime = new Date(); // Kết thúc đo thời gian
        const processingTime = endTime - startTime; // Tính toán thời gian xử lý

        const totalPages = Math.ceil(transactionCount / limit); // Tổng số trang

        res.render('products/index', { 
            transactionResults, // Truyền kết quả giao dịch đến view
            transactionCount,
            totalTransactions: transactionCount,
            currentPage,
            totalPages,
            min_amount,
            max_amount,
            processingTime: `${processingTime} ms` // Hiển thị thời gian xử lý
        });
    } catch (error) {
        console.error('Lỗi khi lấy dữ liệu:', error);
        res.status(500).send('Có lỗi xảy ra.');
    }
});

// Trang chính
app.get('/', (req, res) => {
    res.render('products/index');
});

// Hiển thị dữ liệu với phân trang
app.get('/data', async (req, res) => {
    // Cấu hình pool kết nối MySQL
const pool = mysql.createPool({
    host: 'localhost',
    user: 'root',
    password: '',
    database: 'data' // Chỉ định cơ sở dữ liệu ở đây
});

    const limit = parseInt(req.query.limit) || 1000;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const [totalResults] = await pool.query('SELECT COUNT(*) as total FROM datas');
        const total = totalResults[0].total;
        const totalPages = Math.ceil(total / limit);

        const [results] = await pool.query('SELECT * FROM datas LIMIT ? OFFSET ?', [limit, offset]);
        res.render('products/data', { results, currentPage: Math.floor(offset / limit) + 1, totalPages, limit });
    } catch (err) {
        console.error('Lỗi truy vấn dữ liệu:', err); // In chi tiết lỗi ra console
        res.status(500).send('Có lỗi xảy ra trong quá trình truy vấn dữ liệu.');
    }
});


// Phục vụ tệp HTML
app.use(express.static('public'));

// Khởi động máy chủ
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Máy chủ đang chạy trên http://localhost:${PORT}`);
});
